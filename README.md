# RAG dla Dokumentów

System do indeksowania i odpytywania dokumentów (PDF, DOCX, XLSX, PPTX) przy użyciu lokalnego modelu językowego i bazy wektorowej pgvector.

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
                      │  tabela: chunks          │
                      │  (content, embedding     │
                      │   vector(1024))          │
                      └─────────────────────────┘
```

---

## Komponenty

### Frontend — Next.js 14
- Interfejs użytkownika: strona powitalna, upload plików, chat z dokumentami.
- Wszystkie wywołania `/api/*` są transparentnie proxowane do backendu przez Next.js rewrites (`next.config.js`), co eliminuje CORS.
- W Dockerze proxy wskazuje na `http://api:8000`; natywnie na `http://localhost:8000`.

### Backend API — Django + Django REST Framework
Serwer HTTP na porcie 8000. Udostępnia endpointy:

| Endpoint | Metoda | Działanie |
|---|---|---|
| `/api/upload/` | POST | Przyjmuje plik, zapisuje w MinIO pod `originals/<nazwa>`, publikuje zdarzenie do Kafki |
| `/api/convert/` | POST | Pobiera plik z MinIO, konwertuje do Markdown przez docling (OCR/VLM), uploaduje Markdown do `converted/<stem>.md`, zwraca `minio_key` |
| `/api/ingest/` | POST | Pobiera Markdown z MinIO, dzieli na chunki, embedduje modelem `mmlw-retrieval-roberta-large`, zapisuje wektory do pgvector |
| `/api/query/` | POST | Embedduje pytanie, wykonuje wyszukiwanie cosinusowe w pgvector, buduje prompt z kontekstem, wywołuje LLM, zwraca odpowiedź i cytaty |
| `/api/stats/` | GET | Liczba zaindeksowanych chunków i lista plików |
| `/api/storage/` | GET | Lista obiektów w MinIO |

Wszystkie zasoby (model embeddingowy, LLM, połączenie PostgreSQL, klient MinIO) są ładowane raz przy starcie Django (`AppConfig.ready()`) i przechowywane jako singletony (`api/services.py`).

### Kafka Consumer — Django management command
Osobny proces (`python manage.py run_consumer`) nasłuchujący na topicu `rag.file.uploaded`.

Dla każdej wiadomości wykonuje pełny pipeline:
1. Pobiera oryginalny plik z MinIO → temp dir
2. Konwertuje do Markdown (docling + EasyOCR / Tesseract)
3. Uploaduje Markdown do MinIO (`converted/<stem>.md`)
4. Chunkuje, embedduje i zapisuje do pgvector
5. Usuwa temp dir

Jest to automatyczna ścieżka uruchamiana przez upload. Frontend dodatkowo wywołuje `/api/convert/` i `/api/ingest/` bezpośrednio, by pokazać progress użytkownikowi.

### PostgreSQL + pgvector
Baza danych przechowująca chunki tekstowe i ich wektory embeddingowe.

Tabela `chunks`:
```sql
id           TEXT PRIMARY KEY   -- "<stem>::<chunk_index>"
source       TEXT               -- nazwa pliku źródłowego
heading      TEXT               -- nagłówek sekcji
chunk_index  INTEGER
content      TEXT               -- treść chunka
embedding    vector(1024)       -- wektor mmlw-retrieval-roberta-large
```
Indeks HNSW (`vector_cosine_ops`) przyspiesza wyszukiwanie podobieństwa.

### MinIO
Kompatybilny z S3 object storage. Przechowuje:
- `originals/<nazwa>` — oryginalne pliki wgrane przez użytkownika
- `converted/<stem>.md` — wyeksportowane pliki Markdown

Konsola webowa dostępna na porcie 9001.

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
  ├─[1]─► POST /api/upload/
  │           └─► MinIO: originals/plik.pdf
  │           └─► Kafka: { object_name, filename }
  │
  ├─[2]─► POST /api/convert/  { object_name }
  │           └─► MinIO: pobierz originals/plik.pdf → temp
  │           └─► docling: PDF → Markdown
  │           └─► MinIO: converted/plik.md
  │           └─► ответ: { minio_key: "converted/plik.md" }
  │
  └─[3]─► POST /api/ingest/  { minio_key }
              └─► MinIO: pobierz converted/plik.md → temp
              └─► chunker: Markdown → N chunków po ~400 słów
              └─► SentenceTransformer: encode("Ustep: " + chunk)
              └─► pgvector: INSERT INTO chunks VALUES (...)
              └─► odpowiedź: { chunks: N }

Równolegle (asynchronicznie przez Kafka):
  Kafka Consumer
    └─► pobiera oryginalny plik
    └─► konwertuje → uploaduje → indeksuje
```

### Zapytanie do dokumentów (RAG)

```
Użytkownik wpisuje pytanie
  │
  └─► POST /api/query/  { question }
          │
          ├─[1] encode("Zapytanie: " + pytanie) → wektor zapytania
          │
          ├─[2] SELECT content, source, heading, 1-(embedding<=>q) AS score
          │     FROM chunks ORDER BY embedding<=>q LIMIT 5
          │
          ├─[3] Buduj prompt:
          │       "Context fragments:\n\n[chunk1]\n---\n[chunk2]...\n\nQuestion: ..."
          │
          └─[4] LLM.complete(prompt) → odpowiedź
                  └─► odpowiedź: { answer, context: [{ text, source, heading, score }] }
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
# Pierwsze uruchomienie (buduje obrazy)
.\start.ps1 -Build

# Kolejne uruchomienia (bez przebudowy)
.\start.ps1

# Zatrzymanie wszystkiego
.\start.ps1 -Down
```

Po uruchomieniu:
- Frontend: http://localhost:3000
- Backend API: http://localhost:8000/api/
- MinIO Console: http://localhost:9001 `minioadmin / minioadmin`

---

### Docker — uruchomienie ręczne (krok po kroku)

```powershell
# 1. Infrastruktura (PostgreSQL, MinIO, Kafka) — tworzy sieć "ragdla"
docker compose up -d

# 2. Backend — Django API + Kafka Consumer
#    Entrypoint czeka na postgres/minio/kafka, uruchamia migrate, startuje serwis
docker compose -f backend\docker-compose.yml up -d --build

# 3. Frontend — Next.js
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
# Aktywuj środowisko wirtualne
.\venv\Scripts\Activate.ps1

cd backend
python manage.py migrate      # tylko przy pierwszym uruchomieniu
python manage.py runserver 8000
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

Plik `.env` w katalogu głównym projektu (opcjonalny — wartości domyślne są wystarczające dla lokalnego dev):

```env
# Akcelerator: auto | cuda | cpu
DEVICE=auto

# OCR
OCR_ENGINE=easyocr

# LLM lokalny
USE_LOCAL_LLM=true
LOCAL_LLM_MODEL=Qwen/Qwen2.5-1.5B-Instruct

# PostgreSQL
PG_DSN=postgresql://ragdocs:ragdocs@localhost:5432/ragdocs

# MinIO
MINIO_ENDPOINT=http://localhost:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=ragdocs

# Kafka
KAFKA_BOOTSTRAP_SERVERS=["localhost:9094"]
```

> W Dockerze adresy `localhost` są automatycznie nadpisywane przez zmienne środowiskowe w `backend/docker-compose.yml` (postgres → `postgres:5432`, minio → `minio:9000`, kafka → `kafka:9092`).

---

### Wolumeny Docker

| Wolumen | Usługa | Zawartość |
|---|---|---|
| `pgdata` | PostgreSQL | Dane bazy (chunki + wektory) |
| `minio_data` | MinIO | Pliki oryginalne i Markdown |
| `kafka_data` | Kafka | Offsets, logi topicowe |
| `model_cache` | Backend | Modele HuggingFace (embedding + LLM) |
| `sqlite_data` | Backend | SQLite Django (sesje, migracje) |

Dane przeżywają restarty kontenerów. Żeby usunąć wszystko razem z danymi:
```powershell
docker compose down -v
docker compose -f backend\docker-compose.yml down -v
```
