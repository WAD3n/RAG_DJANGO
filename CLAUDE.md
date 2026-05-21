# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

"RAG dla dokumentów" — a document processing pipeline with a Django REST API backend, Next.js frontend, and local LLM inference. Converts PDFs and other documents (OCR/VLM via docling) and answers questions using RAG over a pgvector store.

## Environment

- **Python**: 3.11 (`venv/` at project root)
- **GPU**: Requires CUDA 12.4 — PyTorch is configured for CUDA
- **Activate venv**: `.\venv\Scripts\Activate.ps1` (PowerShell) or `source venv/Scripts/activate` (bash)
- **Node.js**: 22 (frontend)

## Directory Structure

```
backend/          Python backend (Django API + pipeline core)
  core/           Pipeline modules: config, chunker, converter, llm, local_llm, ocr, storage, vectorstore
  api/            Django app: views, serializers, services (singletons), Kafka consumer
  project/        Django project: settings (with LOGGING), urls, wsgi
  manage.py       Django entry point (adds backend/ to sys.path)
  main.py         Typer CLI entry point

frontend/         Next.js 14 app (App Router, TypeScript, styled-jsx)
  app/            layout.tsx, page.tsx, globals.css
  components/     landing, upload, chat, message, sources-panel, docs-sidebar, icons
  lib/            api.ts (Django client), types.ts

docker-compose.yml       Infrastructure: PostgreSQL+pgvector, MinIO, Kafka (KRaft); defines network ragdla
backend/
  Dockerfile             Python 3.11-slim + CUDA PyTorch + requirements.txt
  entrypoint.sh          Waits for postgres/minio/kafka, runs migrate, execs CMD
  docker-compose.yml     api + consumer services; joins external network ragdla
frontend/
  Dockerfile             Node 22 multi-stage: deps → dev | builder → runner
  docker-compose.yml     frontend service; joins external network ragdla
pyproject.toml      ruff configuration
requirements.txt
```

## Running

### Local (native)
```powershell
# Infrastructure first
docker compose up -d

# Backend (activate venv first, run from backend/)
cd backend
python manage.py runserver 8000

# Kafka consumer (separate terminal, inside backend/)
python manage.py run_consumer

# CLI (from backend/)
python main.py convert path/to/document.pdf
python main.py query "What is the total cost?"

# Frontend (from frontend/)
npm run dev    # → http://localhost:3000
```

### Docker (full stack)
```powershell
# 1. Infrastructure (creates network "ragdla")
docker compose up -d

# 2. Backend (api + consumer, requires running infra)
docker compose -f backend/docker-compose.yml up -d --build

# 3. Frontend (requires running api)
docker compose -f frontend/docker-compose.yml up -d --build
```

GPU passthrough requires `nvidia-container-toolkit` on the host.

## Linting

```powershell
# Python (from project root)
.\venv\Scripts\ruff.exe check backend/
.\venv\Scripts\ruff.exe format backend/

# TypeScript (from frontend/)
npx next lint
```

## Architecture

### Backend `sys.path` contract
`backend/manage.py` and `backend/main.py` both insert `backend/` at the front of `sys.path`, making `core`, `api`, `project` importable as top-level packages. This is why imports look like `from core.config import Settings`.

### Service singletons (`api/services.py`)
All heavy objects (embedding model, LLM, PostgreSQL connection, MinIO client) are loaded once at Django startup via `AppConfig.ready()` using double-checked locking. `get_xxx()` accessors trigger `init_all()` on first call if not already initialised.

### Embedding model
`sdadas/mmlw-retrieval-roberta-large` — Polish asymmetric retrieval. Queries must be prefixed `"Zapytanie: "`, passages `"Ustep: "`.

### Configuration
All settings in `.env` at project root. `core/config.py` locates it via `Path(__file__).parent.parent.parent / ".env"`. Key variables:

```
DEVICE=auto
OCR_ENGINE=easyocr
USE_LOCAL_LLM=true
LOCAL_LLM_MODEL=Qwen/Qwen2.5-1.5B-Instruct
PG_DSN=postgresql://ragdocs:ragdocs@localhost:5432/ragdocs
MINIO_ENDPOINT=http://localhost:9000
KAFKA_BOOTSTRAP_SERVERS=["localhost:9094"]
```

### pgvector note
`CREATE EXTENSION vector` must be committed **before** calling `register_vector(conn)` — otherwise psycopg2 cannot find the vector type.

## Windows constraints
- vLLM not supported natively on Windows — use `USE_LOCAL_LLM=true`
- Console encoding cp1250: avoid non-ASCII characters in `typer.echo()` output
- Use `PyPdfiumDocumentBackend` to bypass a double-slash path bug in docling_parse on Windows
