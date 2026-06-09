# Design: Workspaces, Document Summarization, LLM-as-Judge

**Date:** 2026-06-09  
**Status:** Approved  
**Scope:** Three new features for the RAG dla dokumentów project

---

## 1. Workspaces

### Goal
Documents are scoped to workspaces. Users see only documents from workspaces they belong to. Django superadmin creates workspaces and manages membership. Users choose the target workspace when uploading.

### Data Model

```python
class Workspace(models.Model):
    name = models.CharField(max_length=100, unique=True)
    slug = models.SlugField(max_length=100, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    members = models.ManyToManyField(User, through='WorkspaceMembership', related_name='workspaces')

class WorkspaceMembership(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE)
    joined_at = models.DateTimeField(auto_now_add=True)
    class Meta:
        unique_together = [('user', 'workspace')]
```

SQL migration adds `workspace_id` column to the raw `chunks` table:
```sql
ALTER TABLE chunks ADD COLUMN workspace_id INTEGER REFERENCES api_workspace(id) ON DELETE CASCADE;
CREATE INDEX chunks_workspace_idx ON chunks (workspace_id);
```

Existing chunks with `workspace_id = NULL` must be cleared or migrated to a default workspace before the new search logic activates.

### API

| Method | URL | Access | Action |
|--------|-----|--------|--------|
| `GET` | `/api/workspaces/` | auth user | List user's workspaces |
| `GET` | `/api/workspaces/<id>/` | member | Workspace detail + member list |
| `POST` | `/api/workspaces/` | `is_staff` | Create workspace |
| `POST` | `/api/workspaces/<id>/members/` | `is_staff` | Add user to workspace |
| `DELETE` | `/api/workspaces/<id>/members/<user_id>/` | `is_staff` | Remove user |

**Modified endpoints:**

- `POST /api/upload/` — accepts `workspace_id` (multipart field). Validates user is a member.
- `POST /api/query/` — accepts `workspace_id` in JSON body. Search filters `WHERE workspace_id = %s`.
- `GET /api/documents/` — accepts `?workspace_id=` query param.

### Pipeline Changes

Kafka message payload extended:
```json
{ "object_name": "...", "filename": "...", "workspace_id": 3, "file_size_bytes": 1048576 }
```

`VectorStore.ingest(md_path, workspace_id)` — inserts `workspace_id` on every chunk row.

`VectorStore.search(query, workspace_id, n)` — adds `WHERE workspace_id = %s`.

`VectorStore.documents(workspace_id)` — filters by workspace.

### Frontend Changes

- After login: `GET /api/workspaces/` → auto-select if single workspace; show selector modal/dropdown if multiple.
- Active workspace stored in React state + `localStorage`.
- Sidebar header shows active workspace name.
- Upload component receives `workspaceId` prop and sends it with file upload.
- Query calls pass active `workspaceId`.

---

## 2. Document Summarization

### Goal
Documents exceeding a configurable size threshold get an LLM-generated summary. Summary is shown as a tooltip/panel in the sidebar when a document is clicked.

### Trigger

Config in `.env`:
```
SUMMARY_MIN_SIZE_BYTES=1048576   # default 1 MB
```

Added to `core/config.py` as `summary_min_size_bytes: int`.

### Data Model

```python
class DocumentSummary(models.Model):
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE)
    source = models.CharField(max_length=500)   # markdown filename, e.g. "report.md"
    summary = models.TextField()
    file_size_bytes = models.BigIntegerField()
    generated_at = models.DateTimeField(auto_now_add=True)
    class Meta:
        unique_together = [('workspace', 'source')]
```

### Pipeline

In `run_consumer.py`, after successful ingest:
```
if file_size_bytes >= cfg.summary_min_size_bytes:
    summary_text = run_llm(
        prompt=f"Streść poniższy dokument w 3-5 zdaniach:\n\n{markdown[:8000]}",
        system="Jesteś asystentem streszczającym dokumenty. Odpowiadaj po polsku."
    )
    DocumentSummary.objects.update_or_create(
        workspace_id=workspace_id, source=md_name,
        defaults={"summary": summary_text, "file_size_bytes": file_size_bytes}
    )
```

Markdown truncated to 8000 chars to stay within local LLM context limits.

### API

```
GET /api/documents/summary/?source=<url-encoded-md-name>&workspace_id=<id>
```

Returns `{ "summary": "...", "generated_at": "..." }` or 404 if no summary exists.

### Frontend

Sidebar document item: clicking a document expands an inline panel below it showing the summary text. If no summary exists, panel is not shown. Summary fetched on first expand and cached in component state.

---

## 3. LLM-as-Judge

### Goal
After every RAG answer, a second LLM call evaluates the answer for faithfulness, completeness, and hallucination. The verdict is shown to the user as an expandable panel below the assistant message and stored in the database.

### Data Model Change

Add to `Message`:
```python
judge_result = models.JSONField(null=True, blank=True)
# {"verdict": "PASS"|"WARN"|"FAIL", "score": 1-10, "reasoning": "...", "flags": [...]}
```

### Judge Logic (in `QueryView`)

After generating `answer`:
```python
judge_prompt = f"""Context fragments:
{context_text}

Question: {question}
Answer: {answer}

Evaluate the answer. Return JSON only:
{{"verdict": "PASS|WARN|FAIL", "score": 1-10, "reasoning": "<one sentence>", "flags": ["hallucination"|"incomplete"|"off_topic"]}}
"""
judge_raw = run_llm(prompt=judge_prompt, system="You are an answer quality evaluator. Return only valid JSON.")
try:
    judge_result = json.loads(judge_raw)
except (json.JSONDecodeError, ValueError):
    judge_result = None
```

Verdict mapping:
- `PASS` — score 7–10, no flags
- `WARN` — score 4–6 or minor flags (`incomplete`, `off_topic`)
- `FAIL` — score 1–3 or `hallucination` flag present

Judge failure (unparseable JSON) does not block the response — `judge` field is `null`.

### API Response

`POST /api/query/` response extended:
```json
{
  "answer": "...",
  "context": [...],
  "judge": {
    "verdict": "PASS",
    "score": 8,
    "reasoning": "The answer is directly supported by fragment 2.",
    "flags": []
  }
}
```

### Frontend

Expandable panel below each assistant message:
- Collapsed by default, toggled by small badge showing verdict icon (`✅` / `⚠️` / `❌`) + score
- Expanded view shows `reasoning` and `flags`
- If `judge` is null, badge not shown

---

## Migration & Rollout Notes

1. Run Django migration for `Workspace`, `WorkspaceMembership`, `DocumentSummary`, `Message.judge_result`.
2. Apply SQL `ALTER TABLE chunks ADD COLUMN workspace_id ...` via `VectorStore._init_schema()` (add `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`).
3. Create at least one default workspace via Django admin before re-ingesting documents.
4. Re-ingest existing documents under the default workspace (existing chunks have `workspace_id = NULL` and will be orphaned).
5. Add `SUMMARY_MIN_SIZE_BYTES` to `.env`.
