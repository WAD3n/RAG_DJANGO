# RAG dla Dokumentów

System do indeksowania i odpytywania dokumentów (PDF, DOCX, XLSX, PPTX) przy użyciu lokalnego modelu językowego i bazy wektorowej pgvector. Obsługuje wielu użytkowników z logowaniem, historią konwersacji i podglądem cytowanych fragmentów.

---

## Architektura

```
                        PRZEGLĄDARKA
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

## Komponenty

### Frontend — Next.js 14

- **Ekran logowania** — Token authentication, dane trzymane w `localStorage`.
- **Upload dokumentów** — Drag & drop, progress bar dla każdego etapu (upload → convert → ingest).
- **Chat z dokumentami** — Historia konwersacji przypisana do użytkownika, lazy loading wiadomości przy przełączaniu.
- **Panel źródeł** — Cytowane fragmenty z oceną podobieństwa, przycisk "Open in PDF" otwierający dokument na właściwej stronie (`#page=N`).
- **Sidebar** — Lista dokumentów z filtrem, lista konwersacji z rename/delete.
- Wszystkie wywołania `/api/*` są transparentnie proxowane do backendu przez custom route handler (`app/api/[...path]/route.ts`) z timeoutami (convert: 10 min, ingest: 5 min, query: 2 min).

### Backend API — Django + Django REST Framework

Serwer HTTP na porcie 8000. Wszystkie endpointy (poza `/api/auth/login`) wymagają nagłówka `Authorization: Token <token>`.

| Endpoint | Metoda | Działanie |
|---|---|---|
| `/api/auth/login` | POST | Zwraca token dla podanych `username`/`password` |
| `/api/auth/logout` | POST | Unieważnia token |
| `/api/upload` | POST | Przyjmuje plik, zapisuje w MinIO `originals/<nazwa>`, publikuje do Kafki |
| `/api/convert` | POST | Pobiera plik z MinIO, konwertuje do Markdown (docling + OCR/VLM), zapisuje `converted/<stem>.md` |
| `/api/ingest` | POST | Pobiera Markdown z MinIO, chunkuje, embedduje, zapisuje do pgvector |
| `/api/query` | POST | Wyszukiwanie wektorowe + generowanie odpowiedzi przez LLM |
| `/api/documents` | GET | Lista zaindeksowanych dokumentów z liczbą chunków |
| `/api/stats` | GET | Łączna liczba chunków i źródeł |
| `/api/pdf/view` | GET | Serwuje oryginalny plik inline (dla przeglądarki PDF) |
| `/api/storage` | GET | Lista obiektów w MinIO |
| `/api/conversations` | GET / POST | Lista konwersacji użytkownika / tworzenie nowej |
| `/api/conversations/{id}` | PATCH / DELETE | Zmiana tytułu / usunięcie konwersacji |
| `/api/conversations/{id}/messages` | GET / POST | Historia wiadomości / zapis nowych |

Wszystkie zasoby (model embeddingowy, LLM, klient MinIO) są ładowane raz przy starcie Django (`AppConfig.ready()`) i przechowywane jako singletony (`api/services.py`). Django ORM (auth, tokeny, historia chatów) korzysta z tego samego PostgreSQL co pgvector.

### Kafka Consumer — Django management command

Osobny proces (`python manage.py run_consumer`) nasłuchujący na topicu `rag.file.uploaded`.

Dla każdej wiadomości wykonuje pełny pipeline:
1. Pobiera oryginalny plik z MinIO → temp dir
2. Konwertuje do Markdown (docling + EasyOCR / Tesseract)
3. Uploaduje Markdown do MinIO (`converted/<stem>.md`)
4. Chunkuje, embedduje i zapisuje do pgvector
5. Usuwa temp dir

### PostgreSQL + pgvector

Jedna baza danych dla całego systemu — zarówno dane aplikacji (Django ORM) jak i wektory embeddingowe (psycopg2 + pgvector).

Tabela `chunks`:
```sql
id           TEXT PRIMARY KEY   -- "<stem>::<chunk_index>"
source       TEXT               -- nazwa pliku źródłowego (.md)
heading      TEXT               -- nagłówek sekcji
chunk_index  INTEGER
page_no      INTEGER            -- numer strony w oryginalnym dokumencie
content      TEXT               -- treść chunka
embedding    vector(1024)       -- wektor mmlw-retrieval-roberta-large
```
Indeks HNSW (`vector_cosine_ops`) przyspiesza wyszukiwanie podobieństwa.

Tabele Django ORM: `auth_user`, `authtoken_token`, `api_conversation`, `api_message`.

### MinIO

Kompatybilny z S3 object storage. Przechowuje:
- `originals/<nazwa>` — oryginalne pliki wgrane przez użytkownika
- `converted/<stem>.md` — wyeksportowane pliki Markdown

Konsola webowa dostępna na porcie 9001 (`minioadmin` / `minioadmin`).

### Kafka (KRaft — bez Zookeepera)

Broker wiadomości do asynchronicznej komunikacji między API a konsumerem.
- Internal (Docker): `kafka:9092`
- External (host): `localhost:9094`
- Topic: `rag.file.uploaded`

---

## Przepływ danych

### Upload i indeksowanie dokumentu

```
Użytkownik
  │
  ├─[1]─► POST /api/upload
  │           └─► MinIO: originals/plik.pdf
  │           └─► Kafka: { object_name, filename }
  │
  ├─[2]─► POST /api/convert  { object_name }
  │           └─► MinIO: pobierz originals/plik.pdf → temp
  │           └─► docling: PDF → Markdown (z znacznikami stron \f)
  │           └─► MinIO: converted/plik.md
  │           └─► odpowiedź: { minio_key: "converted/plik.md" }
  │
  └─[3]─► POST /api/ingest  { minio_key }
              └─► MinIO: pobierz converted/plik.md → temp
              └─► chunker: Markdown → N chunków po ~400 słów (śledzi page_no)
              └─► SentenceTransformer: encode("Ustep: " + chunk)
              └─► pgvector: INSERT INTO chunks VALUES (...)
              └─► odpowiedź: { chunks: N }

Równolegle (asynchronicznie przez Kafka):
  Kafka Consumer wykonuje ten sam pipeline automatycznie.
```

### Zapytanie do dokumentów (RAG)

```
Użytkownik wpisuje pytanie
  │
  └─► POST /api/query  { question }
          │
          ├─[1] encode("Zapytanie: " + pytanie) → wektor zapytania
          │
          ├─[2] SELECT content, source, heading, page_no,
          │           1-(embedding<=>q) AS score
          │     FROM chunks ORDER BY embedding<=>q LIMIT 5
          │
          ├─[3] Buduj prompt:
          │       "Context fragments:\n\n[chunk1]\n---\n[chunk2]...\n\nQuestion: ..."
          │
          └─[4] LLM.complete(prompt) → odpowiedź + cytaty z page_no
```

### Model embeddingowy

`sdadas/mmlw-retrieval-roberta-large` (1024 dim) — asymetryczne wyszukiwanie dla języka polskiego:
- Zapytanie: prefix `"Zapytanie: "`
- Fragment: prefix `"Ustep: "`

---

## Uruchomienie

### Wymagania

**Docker (zalecane):**
- Docker Desktop z obsługą GPU (`nvidia-container-toolkit`)
- NVIDIA GPU z CUDA 12.4

**Natywne (Windows):**
- Python 3.11, Node.js 22
- CUDA 12.4 + sterowniki NVIDIA
- Docker Desktop (do infrastruktury: PostgreSQL, MinIO, Kafka)

---

### Docker — uruchomienie jednym skryptem

```powershell
# Pierwsze uruchomienie (buduje obrazy + tworzy konto użytkownika)
.\start.ps1 -Build -CreateUser

# Kolejne uruchomienia
.\start.ps1

# Zatrzymanie wszystkiego
.\start.ps1 -Down
```

Po uruchomieniu:
- Frontend: http://localhost:3000
- Backend API: http://localhost:8000/api/
- MinIO Console: http://localhost:9001 `minioadmin / minioadmin`

Ręczne tworzenie konta (jeśli pominięto `-CreateUser`):
```powershell
docker compose -f backend\docker-compose.yml exec api python manage.py createsuperuser
```

---

### Docker — uruchomienie ręczne (krok po kroku)

```powershell
# 1. Infrastruktura (PostgreSQL, MinIO, Kafka) — tworzy sieć "ragdla"
docker compose up -d

# 2. Backend — Django API + Kafka Consumer
#    Entrypoint czeka na postgres/minio/kafka, uruchamia migrate, startuje serwis
docker compose -f backend\docker-compose.yml up -d --build

# 3. Utwórz pierwsze konto
docker compose -f backend\docker-compose.yml exec api python manage.py createsuperuser

# 4. Frontend — Next.js
docker compose -f frontend\docker-compose.yml up -d --build

# Logi
docker compose -f backend\docker-compose.yml logs -f api
docker compose -f backend\docker-compose.yml logs -f consumer
docker compose -f frontend\docker-compose.yml logs -f

# Zatrzymanie
docker compose -f frontend\docker-compose.yml down
docker compose -f backend\docker-compose.yml down
docker compose down
```

---

### Natywne uruchomienie (Windows)

#### Infrastruktura
```powershell
docker compose up -d
```

#### Backend (terminal 1 — Django API)
```powershell
.\venv\Scripts\Activate.ps1
cd backend
python manage.py migrate      # tylko przy pierwszym uruchomieniu
python manage.py createsuperuser  # tylko przy pierwszym uruchomieniu
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
npm install    # tylko przy pierwszym uruchomieniu
npm run dev    # → http://localhost:3000
```

#### CLI — konwersja i indeksowanie z linii poleceń
```powershell
.\venv\Scripts\Activate.ps1
cd backend

# Konwersja dokumentu do Markdown
python main.py convert ..\dokument.pdf

# Konwersja + zapis do pliku
python main.py convert ..\dokument.pdf --output output.md

# Indeksowanie pliku Markdown
python main.py ingest output.md

# Zapytanie do zaindeksowanych dokumentów
python main.py query "Jaki jest całkowity koszt?"

# Statystyki bazy wektorowej
python main.py store-stats
```

---

### Konfiguracja środowiska (`.env`)

Plik `.env` w katalogu głównym projektu. Wartości domyślne wystarczają dla lokalnego dev przy uruchomionej infrastrukturze Docker:

```env
# Akcelerator: auto | cuda | cpu
DEVICE=auto

# OCR
OCR_ENGINE=easyocr

# LLM lokalny (Windows — vLLM nie jest obsługiwany)
USE_LOCAL_LLM=true
LOCAL_LLM_MODEL=Qwen/Qwen2.5-1.5B-Instruct

# PostgreSQL (Django ORM + pgvector)
PG_DSN=postgresql://ragdocs:ragdocs@localhost:5432/ragdocs

# MinIO
MINIO_ENDPOINT=http://localhost:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=ragdocs

# Kafka
KAFKA_BOOTSTRAP_SERVERS=["localhost:9094"]
```

> W Dockerze adresy `localhost` są automatycznie nadpisywane przez zmienne środowiskowe w `backend/docker-compose.yml` (`postgres:5432`, `minio:9000`, `kafka:9092`).

---

### Wolumeny Docker

| Wolumen | Usługa | Zawartość |
|---|---|---|
| `pgdata` | PostgreSQL | Baza danych: chunki, wektory, auth, historia chatów |
| `minio_data` | MinIO | Pliki oryginalne i Markdown |
| `kafka_data` | Kafka | Offsets, logi topicowe |
| `model_cache` | Backend | Modele HuggingFace (embedding + LLM) |

Dane przeżywają restarty kontenerów. Żeby usunąć wszystko razem z danymi:
```powershell
docker compose -f frontend\docker-compose.yml down
docker compose -f backend\docker-compose.yml down -v
docker compose down -v
```
