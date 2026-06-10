"""
Vector store: PostgreSQL + pgvector.

Supports two embedding backends:
  - Local SentenceTransformer (default): mmlw-retrieval uses asymmetric prefixes
      query   → "Zapytanie: <text>"
      passage → "Ustep: <text>"
  - Remote OpenAI-compatible API (e.g. vLLM): nomic-embed-text uses task prefixes
      query   → "search_query: <text>"
      passage → "search_document: <text>"

Set REMOTE_EMBED_BASE_URL in .env to switch to remote embeddings.
"""

import logging
from pathlib import Path

import httpx
import numpy as np
import psycopg2
from pgvector.psycopg2 import register_vector

from core.chunker import Chunk, chunk_markdown
from core.config import Settings

logger = logging.getLogger(__name__)


class _LocalEmbedder:
    QUERY_PREFIX = "Zapytanie: "
    PASSAGE_PREFIX = "Ustep: "

    def __init__(self, settings: Settings) -> None:
        import torch
        from sentence_transformers import SentenceTransformer

        device = "cuda" if settings.device in ("cuda", "auto") and torch.cuda.is_available() else "cpu"
        logger.info("Loading local embedding model — model=%s device=%s", settings.embedding_model, device)
        self._model = SentenceTransformer(settings.embedding_model, device=device)
        self.dim: int = self._model.get_embedding_dimension()
        logger.info("Local embedding model ready — dim=%d", self.dim)

    def embed(self, texts: list[str]) -> np.ndarray:
        return self._model.encode(texts, batch_size=32, show_progress_bar=False, convert_to_numpy=True)


class _RemoteEmbedder:
    QUERY_PREFIX = "search_query: "
    PASSAGE_PREFIX = "search_document: "

    def __init__(self, settings: Settings) -> None:
        self._model = settings.remote_embed_model
        self._http = httpx.Client(
            base_url=settings.remote_embed_base_url,
            headers={"Authorization": f"Bearer {settings.remote_embed_api_key}"},
            timeout=60.0,
        )
        self.dim: int = settings.remote_embed_dim
        logger.info(
            "Remote embedder initialised — base_url=%s model=%s dim=%d",
            settings.remote_embed_base_url,
            self._model,
            self.dim,
        )

    # nomic-embed-text-v1.5 max: 2048 tokens; Polish ~2-3 chars/token → 4000 chars ≈ 1300 tokens
    _MAX_CHARS = 4000

    def embed(self, texts: list[str]) -> np.ndarray:
        truncated = [t[:self._MAX_CHARS] for t in texts]
        try:
            response = self._http.post(
                "/embeddings",
                json={"model": self._model, "input": truncated, "encoding_format": "float"},
            )
            response.raise_for_status()
            data = response.json()["data"]
            data.sort(key=lambda x: x["index"])
            return np.array([item["embedding"] for item in data], dtype=np.float32)
        except httpx.HTTPStatusError as exc:
            logger.error(
                "Remote embedder HTTP error — status=%d body=%s",
                exc.response.status_code,
                exc.response.text[:200],
            )
            raise
        except Exception:
            logger.exception("Remote embedder request failed")
            raise


class VectorStore:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

        if settings.remote_embed_base_url:
            self._embedder = _RemoteEmbedder(settings)
        else:
            self._embedder = _LocalEmbedder(settings)

        logger.info("Connecting to PostgreSQL — dsn=%s", settings.pg_dsn)
        try:
            self._conn = psycopg2.connect(settings.pg_dsn)
            with self._conn.cursor() as cur:
                cur.execute("CREATE EXTENSION IF NOT EXISTS vector")
            self._conn.commit()
            register_vector(self._conn)
            logger.info("PostgreSQL connected and pgvector registered")
        except Exception:
            logger.exception("Failed to connect to PostgreSQL")
            raise

        self._init_schema()

    def _init_schema(self) -> None:
        logger.debug("Initialising database schema")
        dim = self._embedder.dim
        with self._conn.cursor() as cur:
            cur.execute("CREATE EXTENSION IF NOT EXISTS vector")
            cur.execute("""
                SELECT atttypmod FROM pg_attribute
                JOIN pg_class ON pg_attribute.attrelid = pg_class.oid
                WHERE pg_class.relname = 'chunks' AND pg_attribute.attname = 'embedding'
                AND pg_attribute.attnum > 0
            """)
            row = cur.fetchone()
            if row is not None and row[0] != dim:
                logger.warning(
                    "Embedding dimension mismatch (stored=%d, current=%d) — dropping chunks table",
                    row[0], dim,
                )
                cur.execute("DROP INDEX IF EXISTS chunks_hnsw_idx")
                cur.execute("DROP TABLE chunks")
            cur.execute(f"""
                CREATE TABLE IF NOT EXISTS chunks (
                    id           TEXT PRIMARY KEY,
                    source       TEXT NOT NULL,
                    heading      TEXT NOT NULL,
                    chunk_index  INTEGER NOT NULL,
                    page_no      INTEGER NOT NULL DEFAULT 1,
                    content      TEXT NOT NULL,
                    embedding    vector({dim})
                )
            """)
            cur.execute("""
                ALTER TABLE chunks ADD COLUMN IF NOT EXISTS page_no INTEGER NOT NULL DEFAULT 1
            """)
            cur.execute("""
                ALTER TABLE chunks ADD COLUMN IF NOT EXISTS workspace_id INTEGER
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS chunks_workspace_idx ON chunks (workspace_id)
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS chunks_hnsw_idx
                ON chunks USING hnsw (embedding vector_cosine_ops)
            """)
        self._conn.commit()
        logger.debug("Schema ready")

    def ingest(self, md_path: Path, workspace_id: int | None = None) -> int:
        logger.info("Ingesting — source=%s", md_path.name)
        text = md_path.read_text(encoding="utf-8")
        chunks: list[Chunk] = chunk_markdown(
            text,
            max_words=self._settings.chunk_size,
            overlap_words=self._settings.chunk_overlap,
        )
        if not chunks:
            logger.warning("No chunks produced from %s — skipping ingest", md_path.name)
            return 0

        logger.debug("Embedding %d passages for %s", len(chunks), md_path.name)
        passages = [self._embedder.PASSAGE_PREFIX + c.text for c in chunks]
        try:
            embeddings: np.ndarray = self._embedder.embed(passages)
        except Exception:
            logger.exception("Embedding failed for %s", md_path.name)
            raise

        ws_prefix = str(workspace_id) if workspace_id is not None else "global"
        with self._conn.cursor() as cur:
            if workspace_id is not None:
                cur.execute(
                    "DELETE FROM chunks WHERE source = %s AND workspace_id = %s",
                    (md_path.name, workspace_id),
                )
            else:
                cur.execute(
                    "DELETE FROM chunks WHERE source = %s AND workspace_id IS NULL",
                    (md_path.name,),
                )
            for chunk, emb in zip(chunks, embeddings, strict=True):
                cur.execute(
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
                        f"{ws_prefix}::{md_path.stem}::{chunk.chunk_index}",
                        md_path.name,
                        chunk.heading,
                        chunk.chunk_index,
                        chunk.page_no,
                        chunk.text,
                        emb,
                        workspace_id,
                    ),
                )
        self._conn.commit()
        logger.info("Ingest complete — source=%s chunks=%d", md_path.name, len(chunks))
        return len(chunks)

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
                        WHERE workspace_id = %s OR workspace_id IS NULL
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
                        WHERE workspace_id IS NULL
                        ORDER BY embedding <=> %s
                        LIMIT %s
                        """,
                        (q_emb, q_emb, k),
                    )
                rows = cur.fetchall()
        except Exception:
            self._conn.rollback()
            logger.exception("Vector search failed for query=%r", query[:60])
            raise

        results = [
            {
                "text": row[0],
                "source": row[1],
                "heading": row[2],
                "page_no": row[3],
                "score": round(float(row[4]), 4),
            }
            for row in rows
        ]
        logger.debug("Search returned %d results", len(results))
        return results

    def delete(self, source: str, workspace_id: int | None = None) -> int:
        logger.info("Deleting chunks — source=%s workspace_id=%s", source, workspace_id)
        with self._conn.cursor() as cur:
            if workspace_id is not None:
                cur.execute(
                    "DELETE FROM chunks WHERE source = %s AND workspace_id = %s",
                    (source, workspace_id),
                )
            else:
                cur.execute(
                    "DELETE FROM chunks WHERE source = %s AND workspace_id IS NULL",
                    (source,),
                )
            deleted = cur.rowcount
        self._conn.commit()
        logger.info("Deleted %d chunks for source=%s", deleted, source)
        return deleted

    def documents(self, workspace_id: int | None = None) -> list[dict]:
        with self._conn.cursor() as cur:
            if workspace_id is not None:
                # include global docs (workspace_id IS NULL) so legacy data stays visible
                cur.execute("""
                    SELECT source, COUNT(*) AS chunk_count
                    FROM chunks
                    WHERE workspace_id = %s OR workspace_id IS NULL
                    GROUP BY source
                    ORDER BY source
                """, (workspace_id,))
            else:
                cur.execute("""
                    SELECT source, COUNT(*) AS chunk_count
                    FROM chunks
                    WHERE workspace_id IS NULL
                    GROUP BY source
                    ORDER BY source
                """)
            rows = cur.fetchall()
        return [{"source": row[0], "chunks": row[1]} for row in rows]

    def stats(self) -> dict:
        logger.debug("Fetching vector store stats")
        with self._conn.cursor() as cur:
            cur.execute("SELECT COUNT(*), ARRAY_AGG(DISTINCT source) FROM chunks")
            count, sources = cur.fetchone()
        srcs = sorted(sources or [])
        return {
            "total_chunks": count or 0,
            "total_documents": len(srcs),
            "sources": srcs,
        }

    def close(self) -> None:
        self._conn.close()
        logger.info("PostgreSQL connection closed")
