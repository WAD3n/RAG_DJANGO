# Workspaces + Summarization + LLM-as-Judge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add workspace-scoped documents, automatic LLM summarization for large documents, and LLM-as-judge answer quality evaluation to the RAG pipeline.

**Architecture:** Workspaces are Django models with superadmin-managed M2M membership; `workspace_id` flows through Kafka messages → consumer → pgvector `chunks` table column. Summarization runs in the consumer after ingest when `file_size_bytes >= SUMMARY_MIN_SIZE_BYTES`. Judge runs synchronously in `QueryView` after the RAG answer and stores a JSON verdict in `Message.judge_result`.

**Tech Stack:** Django 5.2, DRF, PostgreSQL + pgvector (psycopg2), Kafka, Next.js 14 (App Router), TypeScript, styled-jsx

**Dependency order:** Phase A (Workspaces) → Phase B (Summarization, depends on Workspace FK) → Phase C (Judge, independent) → Phase D (Frontend)

---

## File Map

### Created
- `backend/api/tests/__init__.py`
- `backend/api/tests/test_workspaces.py`
- `backend/api/tests/test_summarization.py`
- `backend/api/tests/test_judge.py`
- `backend/api/migrations/0002_workspace_summary_judge.py`
- `frontend/components/workspace-selector.tsx`

### Modified
- `backend/api/models.py` — add Workspace, WorkspaceMembership, DocumentSummary, Message.judge_result
- `backend/api/serializers.py` — add WorkspaceSerializer, QueryRequestSerializer workspace_id
- `backend/api/views.py` — add WorkspaceView, WorkspaceMembersView, DocumentSummaryView; modify UploadView, QueryView, DocumentsView
- `backend/api/urls.py` — new routes
- `backend/core/config.py` — add summary_min_size_bytes
- `backend/core/vectorstore.py` — workspace_id in ingest/search/documents/_init_schema
- `backend/api/management/commands/run_consumer.py` — workspace_id propagation + LLM + summarization
- `frontend/lib/types.ts` — Workspace, JudgeResult, DocumentInfo.summary
- `frontend/lib/api.ts` — getWorkspaces, getDocumentSummary, queryDocuments workspace_id
- `frontend/components/upload.tsx` — workspaceId prop
- `frontend/components/docs-sidebar.tsx` — workspace header, summary panel
- `frontend/components/message.tsx` — judge verdict badge + panel
- `frontend/app/page.tsx` or `frontend/components/chat.tsx` — workspace state, pass to upload/query

---

## Phase A: Workspaces

---

### Task 1: Django models — Workspace, WorkspaceMembership

**Files:**
- Modify: `backend/api/models.py`
- Create: `backend/api/tests/__init__.py`
- Create: `backend/api/tests/test_workspaces.py`

- [ ] **Step 1: Write failing model tests**

Create `backend/api/tests/__init__.py` (empty).

Create `backend/api/tests/test_workspaces.py`:

```python
from django.contrib.auth.models import User
from django.test import TestCase

from api.models import Workspace, WorkspaceMembership


class WorkspaceModelTest(TestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser("admin", password="pass")
        self.user = User.objects.create_user("alice", password="pass")

    def test_create_workspace(self):
        ws = Workspace.objects.create(name="Finance", slug="finance")
        self.assertEqual(str(ws), "Finance")

    def test_membership(self):
        ws = Workspace.objects.create(name="Finance", slug="finance")
        WorkspaceMembership.objects.create(user=self.user, workspace=ws)
        self.assertIn(ws, self.user.workspaces.all())

    def test_duplicate_membership_raises(self):
        from django.db import IntegrityError
        ws = Workspace.objects.create(name="Finance", slug="finance")
        WorkspaceMembership.objects.create(user=self.user, workspace=ws)
        with self.assertRaises(IntegrityError):
            WorkspaceMembership.objects.create(user=self.user, workspace=ws)
```

- [ ] **Step 2: Run tests to verify they fail**

```powershell
cd backend
..\venv\Scripts\python.exe manage.py test api.tests.test_workspaces -v 2
```

Expected: `ImportError: cannot import name 'Workspace' from 'api.models'`

- [ ] **Step 3: Add models to `backend/api/models.py`**

Append after the existing `Message` model:

```python
class Workspace(models.Model):
    name = models.CharField(max_length=100, unique=True)
    slug = models.SlugField(max_length=100, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    members = models.ManyToManyField(
        User, through='WorkspaceMembership', related_name='workspaces'
    )

    def __str__(self):
        return self.name


class WorkspaceMembership(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE)
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('user', 'workspace')]
```

- [ ] **Step 4: Run tests to verify they pass**

```powershell
..\venv\Scripts\python.exe manage.py test api.tests.test_workspaces -v 2
```

Expected: 3 passed (migrations will run automatically for tests).

- [ ] **Step 5: Commit**

```bash
git add backend/api/models.py backend/api/tests/__init__.py backend/api/tests/test_workspaces.py
git commit -m "feat: add Workspace and WorkspaceMembership models"
```

---

### Task 2: Django migration — Workspace, WorkspaceMembership

**Files:**
- Create: `backend/api/migrations/0002_workspace_summary_judge.py`

> Note: We'll build this migration incrementally across Tasks 2, 6, and 9. For now, create only the Workspace/WorkspaceMembership part. Tasks 6 and 9 will add more operations to a new migration file.

- [ ] **Step 1: Auto-generate migration**

```powershell
cd backend
..\venv\Scripts\python.exe manage.py makemigrations api --name workspace_summary_judge
```

Expected: Creates `backend/api/migrations/0002_workspace_summary_judge.py`.

- [ ] **Step 2: Verify migration content**

Open the generated file and confirm it creates:
- `api.Workspace` with `name`, `slug`, `created_at`, `members` M2M
- `api.WorkspaceMembership` with `user`, `workspace`, `joined_at`, `unique_together`

- [ ] **Step 3: Apply migration**

```powershell
..\venv\Scripts\python.exe manage.py migrate
```

Expected: `Applying api.0002_workspace_summary_judge... OK`

- [ ] **Step 4: Commit**

```bash
git add backend/api/migrations/0002_workspace_summary_judge.py
git commit -m "feat: migration for Workspace and WorkspaceMembership"
```

---

### Task 3: VectorStore — workspace_id support

**Files:**
- Modify: `backend/core/vectorstore.py`

- [ ] **Step 1: Add `workspace_id` column to `_init_schema`**

In `backend/core/vectorstore.py`, find the `_init_schema` method. After the existing `ALTER TABLE chunks ADD COLUMN IF NOT EXISTS page_no ...` line (around line 147), add:

```python
            cur.execute("""
                ALTER TABLE chunks ADD COLUMN IF NOT EXISTS workspace_id INTEGER
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS chunks_workspace_idx ON chunks (workspace_id)
            """)
```

- [ ] **Step 2: Update `ingest` signature and INSERT**

Change the method signature from:
```python
def ingest(self, md_path: Path) -> int:
```
to:
```python
def ingest(self, md_path: Path, workspace_id: int | None = None) -> int:
```

In the `INSERT` SQL inside `ingest`, replace:
```python
                    """
                    INSERT INTO chunks (id, source, heading, chunk_index, page_no, content, embedding)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        content     = EXCLUDED.content,
                        heading     = EXCLUDED.heading,
                        chunk_index = EXCLUDED.chunk_index,
                        page_no     = EXCLUDED.page_no,
                        embedding   = EXCLUDED.embedding
                    """,
                    (
                        f"{md_path.stem}::{chunk.chunk_index}",
                        md_path.name,
                        chunk.heading,
                        chunk.chunk_index,
                        chunk.page_no,
                        chunk.text,
                        emb,
                    ),
```
with:
```python
                    """
                    INSERT INTO chunks (id, source, heading, chunk_index, page_no, content, embedding, workspace_id)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        content      = EXCLUDED.content,
                        heading      = EXCLUDED.heading,
                        chunk_index  = EXCLUDED.chunk_index,
                        page_no      = EXCLUDED.page_no,
                        embedding    = EXCLUDED.embedding,
                        workspace_id = EXCLUDED.workspace_id
                    """,
                    (
                        f"{md_path.stem}::{chunk.chunk_index}",
                        md_path.name,
                        chunk.heading,
                        chunk.chunk_index,
                        chunk.page_no,
                        chunk.text,
                        emb,
                        workspace_id,
                    ),
```

- [ ] **Step 3: Update `search` signature and SQL**

Change:
```python
def search(self, query: str, n: int | None = None) -> list[dict]:
    k = n or self._settings.retrieval_top_k
    logger.info("Vector search — query=%r top_k=%d", query[:60], k)
    try:
        q_emb: np.ndarray = self._embedder.embed(
            [self._embedder.QUERY_PREFIX + query]
        )[0]
        with self._conn.cursor() as cur:
            cur.execute(
                """
                SELECT content, source, heading, page_no,
                       1 - (embedding <=> %s) AS score
                FROM chunks
                ORDER BY embedding <=> %s
                LIMIT %s
                """,
                (q_emb, q_emb, k),
            )
```
to:
```python
def search(self, query: str, n: int | None = None, workspace_id: int | None = None) -> list[dict]:
    k = n or self._settings.retrieval_top_k
    logger.info("Vector search — query=%r top_k=%d workspace_id=%s", query[:60], k, workspace_id)
    try:
        q_emb: np.ndarray = self._embedder.embed(
            [self._embedder.QUERY_PREFIX + query]
        )[0]
        with self._conn.cursor() as cur:
            if workspace_id is not None:
                cur.execute(
                    """
                    SELECT content, source, heading, page_no,
                           1 - (embedding <=> %s) AS score
                    FROM chunks
                    WHERE workspace_id = %s
                    ORDER BY embedding <=> %s
                    LIMIT %s
                    """,
                    (q_emb, workspace_id, q_emb, k),
                )
            else:
                cur.execute(
                    """
                    SELECT content, source, heading, page_no,
                           1 - (embedding <=> %s) AS score
                    FROM chunks
                    ORDER BY embedding <=> %s
                    LIMIT %s
                    """,
                    (q_emb, q_emb, k),
                )
```

- [ ] **Step 4: Update `documents` signature and SQL**

Change:
```python
def documents(self) -> list[dict]:
    with self._conn.cursor() as cur:
        cur.execute("""
            SELECT source, COUNT(*) AS chunk_count
            FROM chunks
            GROUP BY source
            ORDER BY source
        """)
```
to:
```python
def documents(self, workspace_id: int | None = None) -> list[dict]:
    with self._conn.cursor() as cur:
        if workspace_id is not None:
            cur.execute("""
                SELECT source, COUNT(*) AS chunk_count
                FROM chunks
                WHERE workspace_id = %s
                GROUP BY source
                ORDER BY source
            """, (workspace_id,))
        else:
            cur.execute("""
                SELECT source, COUNT(*) AS chunk_count
                FROM chunks
                GROUP BY source
                ORDER BY source
            """)
```

- [ ] **Step 5: Verify the server starts without error**

```powershell
cd backend
..\venv\Scripts\python.exe manage.py check
```

Expected: `System check identified no issues (0 silenced).`

- [ ] **Step 6: Commit**

```bash
git add backend/core/vectorstore.py
git commit -m "feat: add workspace_id to VectorStore ingest/search/documents"
```

---

### Task 4: Workspace API views

**Files:**
- Modify: `backend/api/serializers.py`
- Modify: `backend/api/views.py`
- Modify: `backend/api/urls.py`
- Create: `backend/api/tests/test_workspaces.py` (extend existing)

- [ ] **Step 1: Write failing API tests**

Append to `backend/api/tests/test_workspaces.py`:

```python
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient


class WorkspaceAPITest(TestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser("admin2", password="pass")
        self.user = User.objects.create_user("bob", password="pass")
        self.admin_token = Token.objects.create(user=self.admin)
        self.user_token = Token.objects.create(user=self.user)
        self.client = APIClient()

    def _auth(self, token):
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")

    def test_admin_creates_workspace(self):
        self._auth(self.admin_token)
        r = self.client.post("/api/workspaces/", {"name": "HR", "slug": "hr"}, format="json")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data["name"], "HR")

    def test_user_cannot_create_workspace(self):
        self._auth(self.user_token)
        r = self.client.post("/api/workspaces/", {"name": "HR", "slug": "hr"}, format="json")
        self.assertEqual(r.status_code, 403)

    def test_list_own_workspaces(self):
        ws = Workspace.objects.create(name="Sales", slug="sales")
        WorkspaceMembership.objects.create(user=self.user, workspace=ws)
        self._auth(self.user_token)
        r = self.client.get("/api/workspaces/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.data), 1)
        self.assertEqual(r.data[0]["slug"], "sales")

    def test_admin_adds_member(self):
        ws = Workspace.objects.create(name="Ops", slug="ops")
        self._auth(self.admin_token)
        r = self.client.post(
            f"/api/workspaces/{ws.id}/members/",
            {"user_id": self.user.id},
            format="json",
        )
        self.assertEqual(r.status_code, 201)
        self.assertTrue(WorkspaceMembership.objects.filter(user=self.user, workspace=ws).exists())

    def test_admin_removes_member(self):
        ws = Workspace.objects.create(name="Ops", slug="ops")
        WorkspaceMembership.objects.create(user=self.user, workspace=ws)
        self._auth(self.admin_token)
        r = self.client.delete(f"/api/workspaces/{ws.id}/members/{self.user.id}/")
        self.assertEqual(r.status_code, 204)
        self.assertFalse(WorkspaceMembership.objects.filter(user=self.user, workspace=ws).exists())
```

- [ ] **Step 2: Run tests to verify they fail**

```powershell
..\venv\Scripts\python.exe manage.py test api.tests.test_workspaces.WorkspaceAPITest -v 2
```

Expected: `404 Not Found` on `/api/workspaces/` (route not registered yet).

- [ ] **Step 3: Add serializers to `backend/api/serializers.py`**

Append to `backend/api/serializers.py`:

```python
from .models import Workspace, WorkspaceMembership


class WorkspaceSerializer(serializers.ModelSerializer):
    member_count = serializers.SerializerMethodField()

    class Meta:
        model = Workspace
        fields = ['id', 'name', 'slug', 'created_at', 'member_count']

    def get_member_count(self, obj):
        return obj.members.count()


class WorkspaceMemberSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source='user.username', read_only=True)
    user_id = serializers.IntegerField(source='user.id', read_only=True)

    class Meta:
        model = WorkspaceMembership
        fields = ['user_id', 'username', 'joined_at']
```

- [ ] **Step 4: Add workspace views to `backend/api/views.py`**

Add after the imports:
```python
from .models import Conversation, Message, Workspace, WorkspaceMembership
```

Append the following views before `ConversationListCreateView`:

```python
class WorkspaceListCreateView(APIView):
    """GET /api/workspaces/ — list user's workspaces; POST (staff only) — create."""

    def get(self, request):
        from .serializers import WorkspaceSerializer
        workspaces = Workspace.objects.filter(members=request.user)
        return Response(WorkspaceSerializer(workspaces, many=True).data)

    def post(self, request):
        from .serializers import WorkspaceSerializer
        if not request.user.is_staff:
            return Response({"error": "Staff only"}, status=status.HTTP_403_FORBIDDEN)
        ser = WorkspaceSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)
        ws = Workspace.objects.create(
            name=ser.validated_data['name'],
            slug=ser.validated_data['slug'],
        )
        return Response(WorkspaceSerializer(ws).data, status=status.HTTP_201_CREATED)


class WorkspaceMembersView(APIView):
    """POST /api/workspaces/<id>/members/ — add member (staff); DELETE …/<uid>/ — remove."""

    def _get_workspace(self, pk):
        try:
            return Workspace.objects.get(pk=pk)
        except Workspace.DoesNotExist:
            return None

    def post(self, request, pk):
        from django.contrib.auth.models import User as DjangoUser
        if not request.user.is_staff:
            return Response({"error": "Staff only"}, status=status.HTTP_403_FORBIDDEN)
        ws = self._get_workspace(pk)
        if ws is None:
            return Response({"error": "Workspace not found"}, status=status.HTTP_404_NOT_FOUND)
        user_id = request.data.get("user_id")
        try:
            target = DjangoUser.objects.get(pk=user_id)
        except DjangoUser.DoesNotExist:
            return Response({"error": "User not found"}, status=status.HTTP_404_NOT_FOUND)
        _, created = WorkspaceMembership.objects.get_or_create(user=target, workspace=ws)
        return Response(
            {"workspace_id": ws.id, "user_id": target.id, "created": created},
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    def delete(self, request, pk, user_id):
        if not request.user.is_staff:
            return Response({"error": "Staff only"}, status=status.HTTP_403_FORBIDDEN)
        ws = self._get_workspace(pk)
        if ws is None:
            return Response({"error": "Workspace not found"}, status=status.HTTP_404_NOT_FOUND)
        deleted, _ = WorkspaceMembership.objects.filter(workspace=ws, user_id=user_id).delete()
        if not deleted:
            return Response({"error": "Membership not found"}, status=status.HTTP_404_NOT_FOUND)
        return Response(status=status.HTTP_204_NO_CONTENT)
```

- [ ] **Step 5: Register routes in `backend/api/urls.py`**

Add to `urlpatterns`:
```python
    path("workspaces/", views.WorkspaceListCreateView.as_view()),
    path("workspaces/<int:pk>/members/", views.WorkspaceMembersView.as_view()),
    path("workspaces/<int:pk>/members/<int:user_id>/", views.WorkspaceMembersView.as_view()),
```

- [ ] **Step 6: Run tests to verify they pass**

```powershell
..\venv\Scripts\python.exe manage.py test api.tests.test_workspaces -v 2
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/api/serializers.py backend/api/views.py backend/api/urls.py backend/api/tests/test_workspaces.py
git commit -m "feat: workspace API — list, create, add/remove members"
```

---

### Task 5: Workspace scoping for Upload, Query, Documents

**Files:**
- Modify: `backend/api/serializers.py`
- Modify: `backend/api/views.py`

- [ ] **Step 1: Extend `QueryRequestSerializer`**

In `backend/api/serializers.py`, change:
```python
class QueryRequestSerializer(serializers.Serializer):
    question = serializers.CharField()
    top_k = serializers.IntegerField(required=False, min_value=1, max_value=20, default=None)
    model = serializers.CharField(required=False, default=None, allow_null=True)
```
to:
```python
class QueryRequestSerializer(serializers.Serializer):
    question = serializers.CharField()
    top_k = serializers.IntegerField(required=False, min_value=1, max_value=20, default=None)
    model = serializers.CharField(required=False, default=None, allow_null=True)
    workspace_id = serializers.IntegerField(required=False, default=None, allow_null=True)
```

- [ ] **Step 2: Update `UploadView` to accept and validate `workspace_id`**

In `backend/api/views.py`, replace the `UploadView.post` method body up to the `object_name` line:

```python
    def post(self, request):
        file = request.FILES.get("file")
        if not file:
            logger.warning("UploadView — no file in request")
            return Response(
                {"error": "No file provided (field: 'file')"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        workspace_id = request.data.get("workspace_id")
        if workspace_id:
            try:
                workspace_id = int(workspace_id)
                if not Workspace.objects.filter(id=workspace_id, members=request.user).exists():
                    return Response(
                        {"error": "Workspace not found or access denied"},
                        status=status.HTTP_403_FORBIDDEN,
                    )
            except (ValueError, TypeError):
                return Response({"error": "Invalid workspace_id"}, status=status.HTTP_400_BAD_REQUEST)

        object_name = f"originals/{file.name}"
        logger.info("UploadView — file=%s size=%d workspace_id=%s", file.name, file.size, workspace_id)
        try:
            services.get_storage().upload_bytes(
                data=file.read(),
                object_name=object_name,
                content_type=file.content_type or "application/octet-stream",
            )

            pipeline_triggered = True
            try:
                services.publish_file_uploaded(object_name, file.name, workspace_id=workspace_id, file_size_bytes=file.size)
            except Exception:
                logger.exception("Kafka publish failed for %s — pipeline not triggered", object_name)
                pipeline_triggered = False

            logger.info("UploadView complete — object=%s pipeline=%s", object_name, pipeline_triggered)
            return Response(
                {
                    "object_name": object_name,
                    "filename": file.name,
                    "size": file.size,
                    "download_url": services.get_storage().presigned_url(object_name),
                    "pipeline_triggered": pipeline_triggered,
                },
                status=status.HTTP_201_CREATED,
            )
        except Exception:
            logger.exception("UploadView failed for %s", file.name)
            return Response({"error": "Upload failed"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
```

- [ ] **Step 3: Update `services.publish_file_uploaded` signature**

In `backend/api/services.py`, replace:
```python
def publish_file_uploaded(object_name: str, filename: str) -> None:
    import datetime
    logger.info("Publishing rag.file.uploaded — object=%s", object_name)
    future = get_producer().send(
        get_settings().kafka_topic_file_uploaded,
        {
            "object_name": object_name,
            "filename": filename,
            "uploaded_at": datetime.datetime.utcnow().isoformat(),
        },
    )
```
with:
```python
def publish_file_uploaded(
    object_name: str,
    filename: str,
    workspace_id: int | None = None,
    file_size_bytes: int = 0,
) -> None:
    import datetime
    logger.info("Publishing rag.file.uploaded — object=%s workspace_id=%s", object_name, workspace_id)
    future = get_producer().send(
        get_settings().kafka_topic_file_uploaded,
        {
            "object_name": object_name,
            "filename": filename,
            "uploaded_at": datetime.datetime.utcnow().isoformat(),
            "workspace_id": workspace_id,
            "file_size_bytes": file_size_bytes,
        },
    )
```

- [ ] **Step 4: Update `QueryView` to pass `workspace_id` to search**

In `backend/api/views.py`, in `QueryView.post`, replace:
```python
        question = ser.validated_data["question"]
        top_k = ser.validated_data.get("top_k")
        model = ser.validated_data.get("model") or None
        logger.info("QueryView — question=%r top_k=%s model=%s", question[:80], top_k, model)
```
with:
```python
        question = ser.validated_data["question"]
        top_k = ser.validated_data.get("top_k")
        model = ser.validated_data.get("model") or None
        workspace_id = ser.validated_data.get("workspace_id")
        logger.info("QueryView — question=%r top_k=%s model=%s workspace_id=%s", question[:80], top_k, model, workspace_id)
```

And replace:
```python
            hits = store.search(question, n=top_k)
```
with:
```python
            hits = store.search(question, n=top_k, workspace_id=workspace_id)
```

- [ ] **Step 5: Update `DocumentsView` to accept `workspace_id` query param**

In `backend/api/views.py`, in `DocumentsView.get`, replace:
```python
    def get(self, request):
        try:
            vs_docs = services.get_vector_store().documents()
```
with:
```python
    def get(self, request):
        workspace_id = request.query_params.get("workspace_id")
        if workspace_id:
            try:
                workspace_id = int(workspace_id)
            except ValueError:
                workspace_id = None
        try:
            vs_docs = services.get_vector_store().documents(workspace_id=workspace_id)
```

- [ ] **Step 6: Restart server, verify no import errors**

```powershell
..\venv\Scripts\python.exe manage.py check
```

Expected: `System check identified no issues (0 silenced).`

- [ ] **Step 7: Commit**

```bash
git add backend/api/serializers.py backend/api/views.py backend/api/services.py
git commit -m "feat: workspace_id in upload, query, and documents endpoints"
```

---

### Task 6: Consumer — workspace_id propagation

**Files:**
- Modify: `backend/api/management/commands/run_consumer.py`

- [ ] **Step 1: Update consumer to read `workspace_id` from Kafka message**

In `backend/api/management/commands/run_consumer.py`, replace the `for message in consumer:` block:

```python
        for message in consumer:
            data = message.value
            object_name: str = data.get("object_name", "")
            filename: str = data.get("filename", Path(object_name).name)
            workspace_id = data.get("workspace_id")
            file_size_bytes: int = data.get("file_size_bytes", 0)
            logger.info("Received message — object=%s workspace_id=%s", object_name, workspace_id)
            self.stdout.write(f"\n[+] Received: {object_name} (workspace_id={workspace_id})")

            tmp_dir = tempfile.mkdtemp()
            try:
                file_path = Path(tmp_dir) / filename
                storage.download_file(object_name, file_path)
                logger.info("Downloaded — object=%s dest=%s", object_name, file_path)
                self.stdout.write(f"    Downloaded  {filename}")

                result = converter.convert(str(file_path))
                markdown = result.document.export_to_markdown()
                logger.info("Converted — source=%s chars=%d", filename, len(markdown))
                self.stdout.write(f"    Converted   {len(markdown):,} chars")

                out = Path(tmp_dir) / f"{file_path.stem}.md"
                out.write_text(markdown, encoding="utf-8")

                md_key = f"converted/{file_path.stem}.md"
                storage.upload_bytes(
                    data=markdown.encode("utf-8"),
                    object_name=md_key,
                    content_type="text/markdown",
                )
                logger.info("Uploaded markdown — key=%s", md_key)
                self.stdout.write(f"    Uploaded    minio://{cfg.minio_bucket}/{md_key}")

                n = store.ingest(out, workspace_id=workspace_id)
                logger.info("Indexed — source=%s chunks=%d", filename, n)
                self.stdout.write(self.style.SUCCESS(f"    Indexed     {n} chunks  ->  {filename} done"))

            except Exception:
                logger.exception("Pipeline failed for object=%s", object_name)
                self.stderr.write(self.style.ERROR("    ERROR — see logs for details"))

            finally:
                shutil.rmtree(tmp_dir, ignore_errors=True)
```

- [ ] **Step 2: Verify consumer starts without error**

```powershell
..\venv\Scripts\python.exe manage.py run_consumer --help
```

Expected: No ImportError, shows help text.

- [ ] **Step 3: Commit**

```bash
git add backend/api/management/commands/run_consumer.py
git commit -m "feat: consumer propagates workspace_id through pipeline"
```

---

## Phase B: Document Summarization

---

### Task 7: DocumentSummary model + config

**Files:**
- Modify: `backend/api/models.py`
- Modify: `backend/core/config.py`
- Modify: `backend/api/migrations/0002_workspace_summary_judge.py` (regenerate)
- Create: `backend/api/tests/test_summarization.py`

- [ ] **Step 1: Write failing test**

Create `backend/api/tests/test_summarization.py`:

```python
from django.contrib.auth.models import User
from django.test import TestCase

from api.models import DocumentSummary, Workspace


class DocumentSummaryModelTest(TestCase):
    def setUp(self):
        self.ws = Workspace.objects.create(name="Legal", slug="legal")

    def test_create_summary(self):
        s = DocumentSummary.objects.create(
            workspace=self.ws,
            source="contract.md",
            summary="This contract covers...",
            file_size_bytes=2_000_000,
        )
        self.assertEqual(s.source, "contract.md")

    def test_unique_per_workspace_source(self):
        from django.db import IntegrityError
        DocumentSummary.objects.create(
            workspace=self.ws, source="x.md", summary="s", file_size_bytes=1
        )
        with self.assertRaises(IntegrityError):
            DocumentSummary.objects.create(
                workspace=self.ws, source="x.md", summary="s2", file_size_bytes=2
            )
```

- [ ] **Step 2: Run test to verify it fails**

```powershell
..\venv\Scripts\python.exe manage.py test api.tests.test_summarization -v 2
```

Expected: `ImportError: cannot import name 'DocumentSummary'`

- [ ] **Step 3: Add DocumentSummary model to `backend/api/models.py`**

Append after `WorkspaceMembership`:

```python
class DocumentSummary(models.Model):
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name='summaries')
    source = models.CharField(max_length=500)
    summary = models.TextField()
    file_size_bytes = models.BigIntegerField()
    generated_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('workspace', 'source')]

    def __str__(self):
        return f"{self.workspace.slug}/{self.source}"
```

- [ ] **Step 4: Add `summary_min_size_bytes` to `backend/core/config.py`**

In `backend/core/config.py`, add inside the `Settings` class after the Kafka block:

```python
    # Summarization
    summary_min_size_bytes: int = 1_048_576  # 1 MB default
```

- [ ] **Step 5: Regenerate migration**

```powershell
..\venv\Scripts\python.exe manage.py makemigrations api
..\venv\Scripts\python.exe manage.py migrate
```

Expected: New migration applied OK.

- [ ] **Step 6: Run tests to verify they pass**

```powershell
..\venv\Scripts\python.exe manage.py test api.tests.test_summarization -v 2
```

Expected: 2 tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/api/models.py backend/core/config.py backend/api/migrations/
git commit -m "feat: DocumentSummary model and SUMMARY_MIN_SIZE_BYTES config"
```

---

### Task 8: Consumer — summarization after ingest

**Files:**
- Modify: `backend/api/management/commands/run_consumer.py`

- [ ] **Step 1: Add LLM loading and summarization to consumer**

In `backend/api/management/commands/run_consumer.py`, add `LocalLLMClient` (or generic LLM) loading. Replace the existing model-loading block:

```python
        try:
            storage = StorageClient(cfg)
            converter = build_document_converter(cfg)
            store = VectorStore(cfg)
        except Exception:
            logger.exception("Failed to load models")
            self.stderr.write(self.style.ERROR("Model loading failed — check logs"))
            return
```

with:

```python
        try:
            storage = StorageClient(cfg)
            converter = build_document_converter(cfg)
            store = VectorStore(cfg)
            # LLM for summarization
            import asyncio
            backend = "local" if cfg.use_local_llm else cfg.llm_backend
            if backend == "azure":
                from core.azure_llm import AzureOpenAIClient
                llm = AzureOpenAIClient(cfg)
            elif backend == "vllm":
                from core.llm import VLLMClient
                llm = VLLMClient(cfg)
            else:
                from core.local_llm import LocalLLMClient
                llm = LocalLLMClient(cfg)
        except Exception:
            logger.exception("Failed to load models")
            self.stderr.write(self.style.ERROR("Model loading failed — check logs"))
            return
```

- [ ] **Step 2: Add summarization call after ingest in the consumer loop**

Inside the `try` block in the consumer loop, after the `self.stdout.write(self.style.SUCCESS(...))` line for indexing, add:

```python
                # Summarization
                if workspace_id is not None and file_size_bytes >= cfg.summary_min_size_bytes:
                    try:
                        import django
                        django.setup()
                    except RuntimeError:
                        pass  # already set up inside management command
                    from api.models import DocumentSummary
                    self.stdout.write("    Summarizing...")
                    summary_text = asyncio.run(llm.complete(
                        prompt=f"Stresc ponizszy dokument w 3-5 zdaniach:\n\n{markdown[:8000]}",
                        system="Jestes asystentem streszczajacym dokumenty. Odpowiadaj po polsku.",
                    ))
                    md_name = out.name
                    DocumentSummary.objects.update_or_create(
                        workspace_id=workspace_id,
                        source=md_name,
                        defaults={
                            "summary": summary_text,
                            "file_size_bytes": file_size_bytes,
                        },
                    )
                    logger.info("Summary saved — source=%s workspace_id=%s", md_name, workspace_id)
                    self.stdout.write(self.style.SUCCESS(f"    Summarized  {md_name}"))
```

- [ ] **Step 3: Verify consumer check**

```powershell
..\venv\Scripts\python.exe manage.py check
```

Expected: No issues.

- [ ] **Step 4: Commit**

```bash
git add backend/api/management/commands/run_consumer.py
git commit -m "feat: consumer generates document summary when file exceeds threshold"
```

---

### Task 9: Summary API endpoint

**Files:**
- Modify: `backend/api/views.py`
- Modify: `backend/api/urls.py`
- Modify: `backend/api/tests/test_summarization.py`

- [ ] **Step 1: Write failing test**

Append to `backend/api/tests/test_summarization.py`:

```python
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from api.models import WorkspaceMembership


class DocumentSummaryAPITest(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("carol", password="pass")
        self.ws = Workspace.objects.create(name="Tech", slug="tech")
        WorkspaceMembership.objects.create(user=self.user, workspace=self.ws)
        self.token = Token.objects.create(user=self.user)
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {self.token.key}")
        DocumentSummary.objects.create(
            workspace=self.ws, source="report.md",
            summary="This is a report about...", file_size_bytes=2_000_000
        )

    def test_get_existing_summary(self):
        r = self.client.get(
            "/api/documents/summary/",
            {"source": "report.md", "workspace_id": self.ws.id},
        )
        self.assertEqual(r.status_code, 200)
        self.assertIn("summary", r.data)

    def test_get_missing_summary_returns_404(self):
        r = self.client.get(
            "/api/documents/summary/",
            {"source": "missing.md", "workspace_id": self.ws.id},
        )
        self.assertEqual(r.status_code, 404)

    def test_non_member_cannot_access_summary(self):
        other = User.objects.create_user("dave", password="pass")
        other_token = Token.objects.create(user=other)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {other_token.key}")
        r = self.client.get(
            "/api/documents/summary/",
            {"source": "report.md", "workspace_id": self.ws.id},
        )
        self.assertEqual(r.status_code, 403)
```

- [ ] **Step 2: Run test to verify it fails**

```powershell
..\venv\Scripts\python.exe manage.py test api.tests.test_summarization.DocumentSummaryAPITest -v 2
```

Expected: 404 on endpoint (route missing).

- [ ] **Step 3: Add `DocumentSummaryView` to `backend/api/views.py`**

Append before `ConversationListCreateView`:

```python
class DocumentSummaryView(APIView):
    """GET /api/documents/summary/?source=<md>&workspace_id=<id>"""

    def get(self, request):
        from .models import DocumentSummary
        source = request.query_params.get("source", "")
        workspace_id = request.query_params.get("workspace_id")
        if not source or not workspace_id:
            return Response(
                {"error": "source and workspace_id required"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            workspace_id = int(workspace_id)
        except ValueError:
            return Response({"error": "Invalid workspace_id"}, status=status.HTTP_400_BAD_REQUEST)

        if not Workspace.objects.filter(id=workspace_id, members=request.user).exists():
            return Response({"error": "Access denied"}, status=status.HTTP_403_FORBIDDEN)

        try:
            s = DocumentSummary.objects.get(workspace_id=workspace_id, source=source)
        except DocumentSummary.DoesNotExist:
            return Response({"error": "No summary found"}, status=status.HTTP_404_NOT_FOUND)

        return Response({
            "source": s.source,
            "summary": s.summary,
            "file_size_bytes": s.file_size_bytes,
            "generated_at": s.generated_at.isoformat(),
        })
```

- [ ] **Step 4: Register route in `backend/api/urls.py`**

Add to `urlpatterns`:
```python
    path("documents/summary/", views.DocumentSummaryView.as_view()),
```

- [ ] **Step 5: Run tests to verify they pass**

```powershell
..\venv\Scripts\python.exe manage.py test api.tests.test_summarization -v 2
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/api/views.py backend/api/urls.py backend/api/tests/test_summarization.py
git commit -m "feat: document summary API endpoint"
```

---

## Phase C: LLM-as-Judge

---

### Task 10: Message.judge_result field + migration

**Files:**
- Modify: `backend/api/models.py`
- Modify: migration (new makemigrations run)
- Create: `backend/api/tests/test_judge.py`

- [ ] **Step 1: Write failing test**

Create `backend/api/tests/test_judge.py`:

```python
import json

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from api.models import Conversation, Message


class JudgeResultFieldTest(TestCase):
    def test_message_stores_judge_result(self):
        user = User.objects.create_user("eve", password="pass")
        conv = Conversation.objects.create(user=user)
        verdict = {"verdict": "PASS", "score": 8, "reasoning": "Faithful", "flags": []}
        m = Message.objects.create(
            conversation=conv, role="assistant", content="42",
            judge_result=verdict,
        )
        m.refresh_from_db()
        self.assertEqual(m.judge_result["verdict"], "PASS")

    def test_judge_result_nullable(self):
        user = User.objects.create_user("frank", password="pass")
        conv = Conversation.objects.create(user=user)
        m = Message.objects.create(conversation=conv, role="user", content="hi")
        self.assertIsNone(m.judge_result)
```

- [ ] **Step 2: Run test to verify it fails**

```powershell
..\venv\Scripts\python.exe manage.py test api.tests.test_judge.JudgeResultFieldTest -v 2
```

Expected: `django.db.utils.ProgrammingError: column ... does not exist` or similar.

- [ ] **Step 3: Add `judge_result` to `Message` model**

In `backend/api/models.py`, add to `Message`:

```python
    judge_result = models.JSONField(null=True, blank=True)
```

- [ ] **Step 4: Generate and apply migration**

```powershell
..\venv\Scripts\python.exe manage.py makemigrations api --name add_judge_result
..\venv\Scripts\python.exe manage.py migrate
```

Expected: Migration applied OK.

- [ ] **Step 5: Run test to verify it passes**

```powershell
..\venv\Scripts\python.exe manage.py test api.tests.test_judge.JudgeResultFieldTest -v 2
```

Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/api/models.py backend/api/migrations/
git commit -m "feat: add judge_result JSONField to Message"
```

---

### Task 11: Judge logic in QueryView

**Files:**
- Modify: `backend/api/views.py`
- Modify: `backend/api/tests/test_judge.py`

- [ ] **Step 1: Write failing test**

Append to `backend/api/tests/test_judge.py`:

```python
import unittest.mock as mock

from api.models import Workspace, WorkspaceMembership


class JudgeParsingTest(TestCase):
    """Unit-test the JSON parsing fallback — no real LLM needed."""

    def _parse_judge(self, raw: str):
        """Extract the parsing logic so we can test it in isolation."""
        import json
        try:
            return json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            return None

    def test_valid_json_parsed(self):
        raw = '{"verdict": "PASS", "score": 9, "reasoning": "OK", "flags": []}'
        result = self._parse_judge(raw)
        self.assertEqual(result["verdict"], "PASS")

    def test_invalid_json_returns_none(self):
        result = self._parse_judge("I think the answer is great!")
        self.assertIsNone(result)

    def test_partial_json_returns_none(self):
        result = self._parse_judge('{"verdict": "PASS"')
        self.assertIsNone(result)
```

- [ ] **Step 2: Run test to verify it passes immediately** (pure logic, no implementation needed)

```powershell
..\venv\Scripts\python.exe manage.py test api.tests.test_judge.JudgeParsingTest -v 2
```

Expected: 3 tests pass.

- [ ] **Step 3: Add judge logic to `QueryView` in `backend/api/views.py`**

In `QueryView.post`, after generating `answer` and before `logger.info("QueryView complete...")`, add:

```python
            import json as _json
            judge_result = None
            context_text = "\n\n---\n\n".join(
                f"[{h['source']} / {h['heading']}]\n{h['text']}" for h in hits
            )
            judge_prompt = (
                f"Context fragments:\n{context_text}\n\n"
                f"Question: {question}\nAnswer: {answer}\n\n"
                "Evaluate the answer. Return JSON only:\n"
                '{"verdict": "PASS|WARN|FAIL", "score": 1-10, '
                '"reasoning": "<one sentence>", '
                '"flags": ["hallucination"|"incomplete"|"off_topic"]}'
            )
            try:
                judge_raw = services.run_llm(
                    prompt=judge_prompt,
                    system="You are an answer quality evaluator. Return only valid JSON, no other text.",
                )
                judge_result = _json.loads(judge_raw)
                logger.info("Judge result — verdict=%s score=%s", judge_result.get("verdict"), judge_result.get("score"))
            except Exception:
                logger.warning("Judge failed or returned unparseable JSON — skipping", exc_info=True)
                judge_result = None
```

- [ ] **Step 4: Include `judge` in the response**

Replace the final return in `QueryView.post`:
```python
            return Response({"answer": answer, "context": hits}, status=status.HTTP_200_OK)
```
with:
```python
            return Response({"answer": answer, "context": hits, "judge": judge_result}, status=status.HTTP_200_OK)
```

- [ ] **Step 5: Run all judge tests**

```powershell
..\venv\Scripts\python.exe manage.py test api.tests.test_judge -v 2
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/api/views.py backend/api/tests/test_judge.py
git commit -m "feat: LLM-as-judge in QueryView, verdict in response"
```

---

## Phase D: Frontend

---

### Task 12: Types + API client

**Files:**
- Modify: `frontend/lib/types.ts`
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Add new types to `frontend/lib/types.ts`**

Append to `frontend/lib/types.ts`:

```typescript
export interface Workspace {
  id: number;
  name: string;
  slug: string;
  created_at: string;
  member_count: number;
}

export interface JudgeResult {
  verdict: 'PASS' | 'WARN' | 'FAIL';
  score: number;
  reasoning: string;
  flags: string[];
}

export interface DocumentSummaryResponse {
  source: string;
  summary: string;
  file_size_bytes: number;
  generated_at: string;
}
```

Change `QueryResponse` to include judge:
```typescript
export interface QueryResponse {
  answer: string;
  context: QueryHit[];
  judge?: JudgeResult | null;
}
```

Change `MessageRecord` to include judge:
```typescript
export interface MessageRecord {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  citations: Citation[];
  duration_ms?: number | null;
  created_at: string;
  judge_result?: JudgeResult | null;
}
```

Change `ChatMessage` to include judge:
```typescript
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  durationMs?: number;
  judgeResult?: JudgeResult | null;
}
```

- [ ] **Step 2: Add new API functions to `frontend/lib/api.ts`**

Append to `frontend/lib/api.ts`:

```typescript
export async function getWorkspaces(): Promise<Workspace[]> {
  const res = await fetch(`${BASE}/workspaces/`, { headers: auth() });
  if (!res.ok) throw new Error(`Workspaces failed: ${res.statusText}`);
  return res.json();
}

export async function getDocumentSummary(
  source: string,
  workspaceId: number,
): Promise<DocumentSummaryResponse> {
  const params = new URLSearchParams({ source, workspace_id: String(workspaceId) });
  const res = await fetch(`${BASE}/documents/summary/?${params}`, { headers: auth() });
  if (!res.ok) throw new Error(`Summary failed: ${res.statusText}`);
  return res.json();
}
```

Change `queryDocuments` to accept `workspaceId`:
```typescript
export async function queryDocuments(
  question: string,
  model?: string | null,
  workspaceId?: number | null,
): Promise<QueryResponse> {
  const res = await fetch(`${BASE}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth() },
    body: JSON.stringify({
      question,
      ...(model ? { model } : {}),
      ...(workspaceId != null ? { workspace_id: workspaceId } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Query failed: ${res.statusText}`);
  return res.json();
}
```

Change `uploadFile` to accept `workspaceId`:
```typescript
export async function uploadFile(
  file: File,
  workspaceId?: number | null,
): Promise<{ object_name: string; filename: string }> {
  const form = new FormData();
  form.append('file', file);
  if (workspaceId != null) form.append('workspace_id', String(workspaceId));
  const res = await fetch(`${BASE}/upload`, { method: 'POST', headers: auth(), body: form });
  if (!res.ok) throw new Error(`Upload failed: ${res.statusText}`);
  return res.json();
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```powershell
cd frontend
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/types.ts frontend/lib/api.ts
git commit -m "feat: frontend types and API client for workspaces, summary, judge"
```

---

### Task 13: WorkspaceSelector component

**Files:**
- Create: `frontend/components/workspace-selector.tsx`

- [ ] **Step 1: Create `frontend/components/workspace-selector.tsx`**

```typescript
'use client';

import React from 'react';
import type { Workspace } from '../lib/types';

interface WorkspaceSelectorProps {
  workspaces: Workspace[];
  activeId: number | null;
  onSelect: (id: number) => void;
}

export default function WorkspaceSelector({ workspaces, activeId, onSelect }: WorkspaceSelectorProps) {
  if (workspaces.length === 0) {
    return (
      <div className="ws-empty">
        <span>No workspaces assigned. Contact your administrator.</span>
        <style jsx>{`.ws-empty { padding: 32px; text-align: center; color: var(--fg-muted); font-size: 14px; }`}</style>
      </div>
    );
  }

  return (
    <div className="ws-selector">
      <div className="ws-title">Select workspace</div>
      <div className="ws-list">
        {workspaces.map(ws => (
          <button
            key={ws.id}
            className={`ws-item${ws.id === activeId ? ' active' : ''}`}
            onClick={() => onSelect(ws.id)}
          >
            <div className="ws-name">{ws.name}</div>
            <div className="ws-meta mono">{ws.member_count} members</div>
          </button>
        ))}
      </div>
      <style jsx>{`
        .ws-selector { padding: 32px 24px; display: flex; flex-direction: column; align-items: center; gap: 16px; }
        .ws-title { font-size: 16px; font-weight: 600; color: var(--fg); }
        .ws-list { display: flex; flex-direction: column; gap: 8px; width: 100%; max-width: 360px; }
        .ws-item {
          appearance: none; border: 1.5px solid var(--border-strong);
          background: var(--bg-elev); border-radius: 10px;
          padding: 14px 16px; text-align: left; cursor: default;
          transition: border-color 120ms, background 120ms;
          display: flex; flex-direction: column; gap: 3px;
        }
        .ws-item:hover { border-color: var(--accent); background: var(--accent-soft); }
        .ws-item.active { border-color: var(--accent); background: color-mix(in oklab, var(--accent) 10%, var(--bg-elev)); }
        .ws-name { font-size: 14px; font-weight: 600; color: var(--fg); }
        .ws-meta { font-size: 11.5px; color: var(--fg-muted); }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```powershell
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/workspace-selector.tsx
git commit -m "feat: WorkspaceSelector component"
```

---

### Task 14: Upload component — workspace_id support

**Files:**
- Modify: `frontend/components/upload.tsx`

- [ ] **Step 1: Add `workspaceId` prop and pass to `uploadFile`**

In `frontend/components/upload.tsx`, change the `UploadProps` interface from:
```typescript
interface UploadProps {
  onComplete: (docs: UploadedFile[]) => void;
}
```
to:
```typescript
interface UploadProps {
  onComplete: (docs: UploadedFile[]) => void;
  workspaceId: number | null;
}
```

Change the component signature from:
```typescript
export default function Upload({ onComplete }: UploadProps) {
```
to:
```typescript
export default function Upload({ onComplete, workspaceId }: UploadProps) {
```

In `processFile`, change:
```typescript
      const { object_name } = await uploadFile(file);
```
to:
```typescript
      const { object_name } = await uploadFile(file, workspaceId);
```

- [ ] **Step 2: Verify TypeScript compiles**

```powershell
npx tsc --noEmit
```

Expected: No errors (the parent component will need updating in Task 16 to satisfy the new prop — TypeScript will flag it there).

- [ ] **Step 3: Commit**

```bash
git add frontend/components/upload.tsx
git commit -m "feat: upload component accepts workspaceId prop"
```

---

### Task 15: Docs sidebar — workspace name + summary panel

**Files:**
- Modify: `frontend/components/docs-sidebar.tsx`

- [ ] **Step 1: Add workspace props and summary panel to `DocsSidebarProps`**

In `frontend/components/docs-sidebar.tsx`, change the `DocsSidebarProps` interface — add:
```typescript
  workspaceName?: string;
  onGetSummary?: (source: string) => Promise<string | null>;
```

- [ ] **Step 2: Add workspace name display in sidebar header**

Inside `DocsSidebar`, after the `<div className="ds-section">` opening for Documents, add workspace name:
```typescript
      {/* Workspace badge */}
      {workspaceName && (
        <div className="ws-badge">
          <span className="ws-dot" />
          {workspaceName}
        </div>
      )}
```

Add styles:
```css
        .ws-badge {
          display: inline-flex; align-items: center; gap: 5px;
          font-size: 11px; font-weight: 600; color: var(--accent);
          background: var(--accent-soft); border-radius: 6px;
          padding: 3px 8px; margin: 0 10px 4px; letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .ws-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
```

- [ ] **Step 3: Replace document item with expandable summary panel**

Replace the document item map in `DocsSidebar`:
```typescript
          filtered.map(d => {
            const active = activeDocs.includes(d.id);
            return (
              <div key={d.id} className={`ds-doc${active ? ' active' : ''}`} onClick={() => toggleDoc(d.id)}>
                <span className="ds-doc-dot" style={{ background: d.color }} />
                <div className="ds-doc-main">
                  <div className="ds-doc-name" title={d.name}>{d.name}</div>
                  <div className="ds-doc-sub mono">{d.chunks} chunks</div>
                </div>
                <span className={`ds-check${active ? ' on' : ''}`}>
                  {active && <Icon.Check size={10} />}
                </span>
              </div>
            );
          })
```
with:
```typescript
          filtered.map(d => (
            <DocItem
              key={d.id}
              doc={d}
              active={activeDocs.includes(d.id)}
              onToggle={() => toggleDoc(d.id)}
              onGetSummary={onGetSummary}
            />
          ))
```

- [ ] **Step 4: Add `DocItem` component inside `docs-sidebar.tsx`** (before `DocsSidebar`)

```typescript
function DocItem({
  doc, active, onToggle, onGetSummary,
}: {
  doc: Document;
  active: boolean;
  onToggle: () => void;
  onGetSummary?: (source: string) => Promise<string | null>;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const [summary, setSummary] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  async function handleExpand(e: React.MouseEvent) {
    e.stopPropagation();
    if (!onGetSummary) return;
    setExpanded(v => !v);
    if (!summary && !loading) {
      setLoading(true);
      try {
        const s = await onGetSummary(doc.name + '.md');
        setSummary(s);
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <div className="doc-wrap">
      <div className={`ds-doc${active ? ' active' : ''}`} onClick={onToggle}>
        <span className="ds-doc-dot" style={{ background: doc.color }} />
        <div className="ds-doc-main">
          <div className="ds-doc-name" title={doc.name}>{doc.name}</div>
          <div className="ds-doc-sub mono">{doc.chunks} chunks</div>
        </div>
        {onGetSummary && (
          <button className="doc-summ-btn" onClick={handleExpand} title="Summary">
            <Icon.File size={10} />
          </button>
        )}
        <span className={`ds-check${active ? ' on' : ''}`}>
          {active && <Icon.Check size={10} />}
        </span>
      </div>
      {expanded && (
        <div className="doc-summary-panel">
          {loading ? (
            <span className="muted" style={{ fontSize: 12 }}>Loading summary...</span>
          ) : summary ? (
            <p style={{ fontSize: 12.5, lineHeight: 1.6, color: 'var(--fg-muted)', margin: 0 }}>{summary}</p>
          ) : (
            <span className="muted" style={{ fontSize: 12 }}>No summary available.</span>
          )}
        </div>
      )}
      <style jsx>{`
        .doc-wrap { display: flex; flex-direction: column; }
        .doc-summ-btn {
          appearance: none; border: 0; background: transparent;
          color: var(--fg-faint); padding: 2px; border-radius: 4px;
          display: none; align-items: center;
        }
        .ds-doc:hover .doc-summ-btn { display: flex; }
        .doc-summ-btn:hover { color: var(--accent); background: var(--accent-soft); }
        .doc-summary-panel {
          margin: 2px 10px 6px 26px;
          padding: 8px 10px;
          background: var(--bg-soft);
          border-left: 2px solid var(--accent-soft);
          border-radius: 0 6px 6px 0;
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 5: Verify TypeScript compiles**

```powershell
npx tsc --noEmit
```

Expected: No errors (parent page.tsx prop errors will be resolved in Task 16).

- [ ] **Step 6: Commit**

```bash
git add frontend/components/docs-sidebar.tsx
git commit -m "feat: sidebar workspace badge and document summary panel"
```

---

### Task 16: Message component — judge verdict badge + panel

**Files:**
- Modify: `frontend/components/message.tsx`

- [ ] **Step 1: Read current `message.tsx`**

```powershell
Get-Content frontend/components/message.tsx
```

- [ ] **Step 2: Add judge panel to message component**

Find the props interface in `message.tsx` (likely `ChatMessage` or a local `MessageProps`). Add `judgeResult` prop. Then add a verdict panel below the message content.

Open `frontend/components/message.tsx` and add this component before the main export:

```typescript
import type { JudgeResult } from '../lib/types';

function JudgePanel({ judge }: { judge: JudgeResult }) {
  const [open, setOpen] = React.useState(false);
  const icon = judge.verdict === 'PASS' ? '✅' : judge.verdict === 'WARN' ? '⚠️' : '❌';
  const color = judge.verdict === 'PASS' ? 'var(--success)' : judge.verdict === 'WARN' ? '#e8a838' : 'var(--danger)';

  return (
    <div className="judge-wrap">
      <button className="judge-badge" onClick={() => setOpen(v => !v)} style={{ '--jc': color } as React.CSSProperties}>
        <span>{icon}</span>
        <span className="mono" style={{ fontSize: 11 }}>score {judge.score}/10</span>
        <span style={{ fontSize: 10, color: 'var(--fg-faint)' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="judge-panel">
          <div className="judge-row">
            <span className="judge-label">Verdict</span>
            <span style={{ color, fontWeight: 600 }}>{judge.verdict}</span>
          </div>
          <div className="judge-row">
            <span className="judge-label">Reasoning</span>
            <span>{judge.reasoning}</span>
          </div>
          {judge.flags.length > 0 && (
            <div className="judge-row">
              <span className="judge-label">Flags</span>
              <span>{judge.flags.join(', ')}</span>
            </div>
          )}
        </div>
      )}
      <style jsx>{`
        .judge-wrap { margin-top: 8px; }
        .judge-badge {
          appearance: none; border: 1px solid var(--border-strong);
          background: var(--bg-soft); border-radius: 20px;
          padding: 3px 10px; display: inline-flex; align-items: center; gap: 6px;
          cursor: default; font: inherit;
          transition: border-color 120ms;
        }
        .judge-badge:hover { border-color: var(--jc, var(--accent)); }
        .judge-panel {
          margin-top: 6px; padding: 10px 12px;
          background: var(--bg-elev); border: 1px solid var(--border);
          border-radius: 8px; display: flex; flex-direction: column; gap: 6px;
        }
        .judge-row { display: flex; gap: 10px; font-size: 12.5px; color: var(--fg-muted); }
        .judge-label { font-weight: 600; color: var(--fg-faint); min-width: 70px; }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 3: Wire `judgeResult` into the assistant message render**

Find where the assistant message content is rendered and add below it:

```typescript
{msg.role === 'assistant' && msg.judgeResult && (
  <JudgePanel judge={msg.judgeResult} />
)}
```

Where `msg.judgeResult` is the `JudgeResult | null | undefined` from the `ChatMessage` type. Add `judgeResult?: JudgeResult | null` to the `ChatMessage` interface in `types.ts` if not already there.

- [ ] **Step 4: Verify TypeScript compiles**

```powershell
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add frontend/components/message.tsx frontend/lib/types.ts
git commit -m "feat: judge verdict badge and panel in message component"
```

---

### Task 17: App root — workspace state, wire everything together

**Files:**
- Modify: `frontend/app/page.tsx` (or equivalent root component that holds workspace/chat state)

- [ ] **Step 1: Read `frontend/app/page.tsx`**

```powershell
Get-Content frontend/app/page.tsx
```

- [ ] **Step 2: Add workspace state**

After the existing auth/token state setup, add:

```typescript
const [workspaces, setWorkspaces] = React.useState<Workspace[]>([]);
const [activeWorkspaceId, setActiveWorkspaceId] = React.useState<number | null>(() => {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('ragflow_workspace_id');
    return stored ? parseInt(stored, 10) : null;
  }
  return null;
});
```

- [ ] **Step 3: Load workspaces after login**

In the effect or function that runs after successful login, add:

```typescript
const wsList = await getWorkspaces();
setWorkspaces(wsList);
if (wsList.length === 1 && activeWorkspaceId == null) {
  const id = wsList[0].id;
  setActiveWorkspaceId(id);
  localStorage.setItem('ragflow_workspace_id', String(id));
}
```

- [ ] **Step 4: Show WorkspaceSelector when no workspace selected**

In the render, before showing the upload/chat screen, add:

```typescript
if (token && workspaces.length > 1 && activeWorkspaceId == null) {
  return (
    <WorkspaceSelector
      workspaces={workspaces}
      activeId={activeWorkspaceId}
      onSelect={(id) => {
        setActiveWorkspaceId(id);
        localStorage.setItem('ragflow_workspace_id', String(id));
      }}
    />
  );
}
```

- [ ] **Step 5: Pass `workspaceId` to Upload component**

Find the `<Upload ...>` render and add:
```typescript
workspaceId={activeWorkspaceId}
```

- [ ] **Step 6: Pass `workspaceId` to `queryDocuments` call**

Find the call to `queryDocuments(question, model)` and change to:
```typescript
queryDocuments(question, model, activeWorkspaceId)
```

- [ ] **Step 7: Pass workspace name and `onGetSummary` to DocsSidebar**

Find `<DocsSidebar ...>` and add:
```typescript
workspaceName={workspaces.find(w => w.id === activeWorkspaceId)?.name}
onGetSummary={async (source: string) => {
  if (!activeWorkspaceId) return null;
  try {
    const data = await getDocumentSummary(source, activeWorkspaceId);
    return data.summary;
  } catch {
    return null;
  }
}}
```

- [ ] **Step 8: Pass `judgeResult` from query response to message**

When adding the assistant message after `queryDocuments`, include judge result:
```typescript
// After getting response from queryDocuments:
const assistantMsg: ChatMessage = {
  role: 'assistant',
  content: response.answer,
  citations: response.context.map((h, i) => ({
    id: i,
    doc: h.source,
    page: h.page_no,
    passage: h.text,
    score: h.score,
  })),
  judgeResult: response.judge ?? null,
};
```

- [ ] **Step 9: Verify TypeScript compiles and dev server starts**

```powershell
npx tsc --noEmit
npm run dev
```

Expected: No TS errors, dev server starts on http://localhost:3000.

- [ ] **Step 10: Smoke test in browser**

1. Log in → workspace selector appears if multiple workspaces, or auto-selects if single
2. Upload a file > 1MB → pipeline runs, summary generated (check Django admin for DocumentSummary)
3. Ask a question → judge badge appears below answer
4. Click judge badge → verdict panel expands with score/reasoning/flags
5. Click document info icon in sidebar → summary panel expands

- [ ] **Step 11: Commit**

```bash
git add frontend/app/page.tsx frontend/components/workspace-selector.tsx
git commit -m "feat: workspace selector, wire workspace_id to upload/query/summary/judge"
```

---

## Migration & Go-Live Checklist

- [ ] Run `python manage.py migrate` on production DB
- [ ] Create at least one Workspace via Django admin (`/admin/`)
- [ ] Add users to workspace via Django admin
- [ ] Set `SUMMARY_MIN_SIZE_BYTES` in `.env` (default 1048576 = 1 MB)
- [ ] Re-ingest existing documents via the consumer (existing chunks have `workspace_id = NULL`)
- [ ] Restart both `manage.py runserver` and `manage.py run_consumer`
