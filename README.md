# RAG for Documents

A system for indexing and querying documents (PDF, DOCX, XLSX, PPTX) using a local language model and a pgvector vector store. Supports multiple users with login, conversation history, and preview of cited fragments.

---

## Architecture

```
                        BROWSER
                   http://localhost:3000
                           │
                           │ HTTP
                           ▼
              ┌────────────────────────┐
              │   FRONTEND (Next.js)   │
              │      port 3000         │
              │  /api/* ──proxy──►     │
              └──────────┬─────────────┘
                         │ HTTP  /api/*
                         ▼
              ┌────────────────────────┐
              │  BACKEND API (Django)  │
              │      port 8000         │
              │  auth · chat · RAG     │
              └──┬──────────────┬──────┘
                 │              │
        ┌────────▼──────┐  ┌────▼────────────┐
        │  MinIO (S3)   │  │  Kafka (KRaft)  │
        │  port 9000    │  │  port 9094      │
        │  originals/   │  │  rag.file.      │
        │  converted/   │  │  uploaded       │
        └────────┬──────┘  └────┬────────────┘
                 │              │ consume
                 │    ┌─────────▼─────────────┐
                 │    │  KAFKA CONSUMER       │
                 │    │  (Django mgmt cmd)    │
                 │    │  download → convert   │
                 └────►  → upload → ingest    │
                      └──────────┬────────────┘
                                 │ INSERT embeddings
                                 ▼
                      ┌─────────────────────────┐
                      │  PostgreSQL + pgvector   │
                      │       port 5432          │
                      │  chunks · auth · history │
                      │  (Django ORM + pgvector) │
                      └─────────────────────────┘
```

---

## Components

### Frontend — Next.js 14

- **Login screen** — Token authentication (JWT-less, Django Token), data kept in `localStorage`.
- **Document upload** — Drag & drop, progress bar for each stage (upload → convert → ingest).
- **Chat with documents** — Conversation history assigned to the user, lazy loading of messages when switching. LLM model selection from a dropdown next to the "Ask" button.
- **Sources panel** — Cited fragments with a similarity score, "Open in PDF" button that opens the document at the correct page (`#page=N`).
- **Sidebar** — List of documents with a filter, list of conversations with rename/delete.
- All `/api/*` calls are transparently proxied to the backend through a custom route handler (`app/api/[...path]/route.ts`) with timeouts (convert: 10 min, ingest: 5 min, query: 2 min).

### Backend API — Django + Django REST Framework

HTTP server on port 8000. All endpoints (except `/api/auth/login`) require an `Authorization: Token <token>` header.

| Endpoint | Method | Action |
|---|---|---|
| `/api/auth/login` | POST | Returns a token for the given `username`/`password` |
| `/api/auth/logout` | POST | Invalidates the token |
| `/api/upload` | POST | Accepts a file, saves it in MinIO `originals/<name>`, publishes to Kafka |
| `/api/convert` | POST | Fetches the file from MinIO, converts it to Markdown (docling + OCR/VLM), saves `converted/<stem>.md` |
| `/api/ingest` | POST | Fetches Markdown from MinIO, chunks it, embeds it, saves it to pgvector |
| `/api/query` | POST | Vector search + answer generation by the LLM |
| `/api/documents` | GET | List of indexed documents with chunk counts |
| `/api/models` | GET | Available LLM models and the active backend |
| `/api/stats` | GET | Total number of chunks and sources |
| `/api/pdf/view` | GET | Serves the original file inline (for the PDF viewer) |
| `/api/storage` | GET | List of objects in MinIO |
| `/api/conversations` | GET / POST | List of the user's conversations / create a new one |
| `/api/conversations/{id}` | PATCH / DELETE | Rename / delete a conversation |
| `/api/conversations/{id}/messages` | GET / POST | Message history / save new messages |

All resources (embedding model, LLM, MinIO client) are loaded once when Django starts (`AppConfig.ready()`) and kept as singletons (`api/services.py`). The Django ORM (auth, tokens, chat history) uses the same PostgreSQL instance as pgvector.

### Kafka Consumer — Django management command

A separate process (`python manage.py run_consumer`) listening on the `rag.file.uploaded` topic.

For each message it runs the full pipeline:
1. Fetches the original file from MinIO → temp dir
2. Converts it to Markdown (docling + EasyOCR / Tesseract)
3. Uploads the Markdown to MinIO (`converted/<stem>.md`)
4. Chunks it, embeds it, and saves it to pgvector
5. Removes the temp dir

### PostgreSQL + pgvector

One database for the whole system — both application data (Django ORM) and embedding vectors (psycopg2 + pgvector).

`chunks` table:
```sql
id           TEXT PRIMARY KEY   -- "<stem>::<chunk_index>"
source       TEXT               -- source file name (.md)
heading      TEXT               -- section heading
chunk_index  INTEGER
page_no      INTEGER            -- page number in the original document
content      TEXT               -- chunk content
embedding    vector(N)          -- N=1024 (mmlw-roberta) or N=768 (nomic-embed-text-v1.5)
```
> Dimension N is set automatically at startup based on the embedding model. Changing the model drops and recreates the table — documents must be re-indexed.
The HNSW index (`vector_cosine_ops`) speeds up similarity search.

Django ORM tables: `auth_user`, `authtoken_token`, `api_conversation`, `api_message`.

### MinIO

S3-compatible object storage. Stores:
- `originals/<name>` — original files uploaded by the user
- `converted/<stem>.md` — exported Markdown files

Web console available on port 9001 (`minioadmin` / `minioadmin`).

### Kafka (KRaft — without Zookeeper)

Message broker for asynchronous communication between the API and the consumer.
- Internal (Docker): `kafka:9092`
- External (host): `localhost:9094`
- Topic: `rag.file.uploaded`

---

## Data flow

### Document upload and indexing

```
User
  │
  ├─[1]─► POST /api/upload
  │           └─► MinIO: originals/file.pdf
  │           └─► Kafka: { object_name, filename }
  │
  ├─[2]─► POST /api/convert  { object_name }
  │           └─► MinIO: fetch originals/file.pdf → temp
  │           └─► docling: PDF → Markdown (with page markers \f)
  │           └─► MinIO: converted/file.md
  │           └─► response: { minio_key: "converted/file.md" }
  │
  └─[3]─► POST /api/ingest  { minio_key }
              └─► MinIO: fetch converted/file.md → temp
              └─► chunker: Markdown → N chunks of ~400 words (tracks page_no)
              └─► embedder: encode("Ustep: " / "search_document: " + chunk)
              │           (locally: SentenceTransformer / remotely: API)
              └─► pgvector: INSERT INTO chunks VALUES (...)
              └─► response: { chunks: N }

In parallel (asynchronously via Kafka):
  The Kafka Consumer runs the same pipeline automatically.
```

### Document query (RAG)

```
User types a question
  │
  └─► POST /api/query  { question }
          │
          ├─[1] embed("Zapytanie: " + question) → query vector
          │       (locally: mmlw-roberta / remotely: nomic-embed via API)
          │
          ├─[2] SELECT content, source, heading, page_no,
          │           1-(embedding<=>q) AS score
          │     FROM chunks ORDER BY embedding<=>q LIMIT 5
          │
          ├─[3] Build prompt:
          │       "Context fragments:\n\n[chunk1]\n---\n[chunk2]...\n\nQuestion: ..."
          │
          └─[4] LLM.complete(prompt) → answer + citations with page_no
```

### Embedding model

Two modes — selected via `REMOTE_EMBED_BASE_URL` in `.env`:

**Local (default):** `sdadas/mmlw-retrieval-roberta-large` (1024 dim)
- Asymmetric retrieval for Polish
- Query: prefix `"Zapytanie: "` · Passage: prefix `"Ustep: "`

**Remote (OpenAI-compatible API):** e.g. `nomic-ai/nomic-embed-text-v1.5` (768 dim) via vLLM
- Query: prefix `"search_query: "` · Passage: prefix `"search_document: "`
- Texts truncated to 4000 characters before sending (model limit of 2048 tokens)

---

## Running

### Requirements

**Docker (recommended):**
- Docker Desktop with GPU support (`nvidia-container-toolkit`)
- NVIDIA GPU with CUDA 12.4

**Native (Windows):**
- Python 3.11, Node.js 22
- CUDA 12.4 + NVIDIA drivers
- Docker Desktop (for infrastructure: PostgreSQL, MinIO, Kafka)

---

### Docker — single-script startup

```powershell
# First run (builds images + creates a user account)
.\start.ps1 -Build -CreateUser

# Subsequent runs
.\start.ps1

# Stop everything
.\start.ps1 -Down
```

After startup:
- Frontend: http://localhost:3000
- Backend API: http://localhost:8000/api/
- MinIO Console: http://localhost:9001 `minioadmin / minioadmin`

Manual account creation (if `-CreateUser` was skipped):
```powershell
docker compose -f backend\docker-compose.yml exec api python manage.py createsuperuser
```

---

### Docker — manual startup (step by step)

```powershell
# 1. Infrastructure (PostgreSQL, MinIO, Kafka) — creates the network "ragdla"
docker compose up -d

# 2. Backend — Django API + Kafka Consumer
#    The entrypoint waits for postgres/minio/kafka, runs migrate, starts the service
docker compose -f backend\docker-compose.yml up -d --build

# 3. Create the first account
docker compose -f backend\docker-compose.yml exec api python manage.py createsuperuser

# 4. Frontend — Next.js
docker compose -f frontend\docker-compose.yml up -d --build

# Logs
docker compose -f backend\docker-compose.yml logs -f api
docker compose -f backend\docker-compose.yml logs -f consumer
docker compose -f frontend\docker-compose.yml logs -f

# Stop
docker compose -f frontend\docker-compose.yml down
docker compose -f backend\docker-compose.yml down
docker compose down
```

---

### Native startup (Windows)

#### Infrastructure
```powershell
docker compose up -d
```

#### Backend (terminal 1 — Django API)
```powershell
.\venv\Scripts\Activate.ps1
cd backend
python manage.py migrate      # first run only
python manage.py createsuperuser  # first run only
python manage.py runserver --noreload 8000
```

#### Kafka Consumer (terminal 2)
```powershell
.\venv\Scripts\Activate.ps1
cd backend
python manage.py run_consumer
```

#### Frontend (terminal 3)
```powershell
cd frontend
npm install    # first run only
npm run dev    # → http://localhost:3000
```

#### CLI — conversion and indexing from the command line
```powershell
.\venv\Scripts\Activate.ps1
cd backend

# Convert a document to Markdown
python main.py convert ..\document.pdf

# Convert + save to a file
python main.py convert ..\document.pdf --output output.md

# Index a Markdown file
python main.py ingest output.md

# Query the indexed documents
python main.py query "What is the total cost?"

# Vector store statistics
python main.py store-stats
```

---

### Environment configuration (`.env`)

The `.env` file lives in the project root. The default values are sufficient for local dev with the Docker infrastructure running:

```env
DEVICE=auto
OCR_ENGINE=easyocr

# LLM: local | vllm | azure
LLM_BACKEND=local
LOCAL_LLM_MODEL=Qwen/Qwen2.5-0.5B-Instruct

# Local embeddings (default)
EMBEDDING_MODEL=sdadas/mmlw-retrieval-roberta-large

# Remote embeddings — when set, overrides local
# REMOTE_EMBED_BASE_URL=http://<host>:7666/v1
# REMOTE_EMBED_DIM=768

# PostgreSQL
PG_DSN=postgresql://ragdocs:ragdocs@localhost:5432/ragdocs

# MinIO
MINIO_ENDPOINT=http://localhost:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin

# Kafka
KAFKA_BOOTSTRAP_SERVERS=["localhost:9094"]
```
Full list of variables with descriptions in `.env.example`.

> In Docker, `localhost` addresses are automatically overridden by environment variables in `backend/docker-compose.yml` (`postgres:5432`, `minio:9000`, `kafka:9092`).

---

### Docker volumes

| Volume | Service | Contents |
|---|---|---|
| `pgdata` | PostgreSQL | Database: chunks, vectors, auth, chat history |
| `minio_data` | MinIO | Original and Markdown files |
| `kafka_data` | Kafka | Offsets, topic logs |
| `model_cache` | Backend | HuggingFace models (embedding + LLM) |

Data survives container restarts. To remove everything including data:
```powershell
docker compose -f frontend\docker-compose.yml down
docker compose -f backend\docker-compose.yml down -v
docker compose down -v
```

---

## LLM backends

Backend selection via the `LLM_BACKEND` variable in `.env` (when `USE_LOCAL_LLM=false`):

| Value | Backend | Description |
|---------|---------|------|
| `local` | Qwen2.5-1.5B-Instruct | locally on GPU, via HuggingFace Transformers |
| `azure` | Azure OpenAI | production-grade, deployment selection from the UI |
| `vllm` | vLLM OpenAI API | compatible endpoint `/v1/chat/completions` |

### Azure OpenAI

```env
LLM_BACKEND=azure
USE_LOCAL_LLM=false
AZURE_ENDPOINT=https://<resource>.cognitiveservices.azure.com/
AZURE_API_KEY=<key>
AZURE_API_VERSION=2024-02-01
AZURE_DEPLOYMENT=gpt-5.4
AZURE_DEPLOYMENTS=["gpt-5.4","gpt-4o"]   # list shown in the UI dropdown
```

### Remote embedding (nomic-embed-text-v1.5 via vLLM)

When `REMOTE_EMBED_BASE_URL` is set, embedding happens remotely instead of locally:

```env
REMOTE_EMBED_BASE_URL=http://<host>:7666/v1
REMOTE_EMBED_MODEL=nomic-ai/nomic-embed-text-v1.5
REMOTE_EMBED_API_KEY=EMPTY
REMOTE_EMBED_DIM=768
```

Prefixes for nomic-embed: query → `search_query: `, passage → `search_document: `.

---

## Observability

The PLG stack (Prometheus + Loki + Grafana) starts automatically via `.\start.ps1`.

```powershell
# Observability only
docker compose -f observability\docker-compose.yml up -d
```

| Service | URL |
|--------|-----|
| Grafana | http://localhost:3001 (admin / admin) |
| Prometheus | http://localhost:9090 |
| Loki | http://localhost:3100 |

### Dashboards (auto-provisioned)

**RAG — Logs**
- Log volume per service (chart)
- Live logs: API, Consumer
- Error stream from all services

**RAG — Container Metrics**
- CPU and memory per container
- Network traffic Rx/Tx
- GPU: utilization (%), VRAM (used/free), temperature, power draw

### GPU metrics (DCGM Exporter)

Requires the NVIDIA Container Toolkit on the host. Without it, GPU panels show "No data"; the rest of observability works normally.

Exported metrics: `DCGM_FI_DEV_GPU_UTIL`, `DCGM_FI_DEV_FB_USED`, `DCGM_FI_DEV_FB_FREE`, `DCGM_FI_DEV_GPU_TEMP`, `DCGM_FI_DEV_POWER_USAGE`.

### Django metrics

The backend exposes `/metrics` (django-prometheus) — scraped by Prometheus every 15 s. Available: HTTP request counters, latency, Python garbage collector, ORM counters.
