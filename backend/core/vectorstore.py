"""
Vector store: PostgreSQL + pgvector + sentence-transformers.

mmlw-retrieval uses asymmetric retrieval:
  query   → "Zapytanie: <text>"
  passage → "Ustep: <text>"
"""

import logging
from pathlib import Path

import numpy as np
import psycopg2
import torch
from pgvector.psycopg2 import register_vector
from sentence_transformers import SentenceTransformer

from core.chunker import Chunk, chunk_markdown
from core.config import Settings

logger = logging.getLogger(__name__)


def _device(settings: Settings) -> str:
    if settings.device in ("cuda", "auto"):
        return "cuda" if torch.cuda.is_available() else "cpu"
    return "cpu"


class VectorStore:
    QUERY_PREFIX = "Zapytanie: "
    PASSAGE_PREFIX = "Ustep: "

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        device = _device(settings)
        logger.info(
            "Loading embedding model — model=%s device=%s",
            settings.embedding_model,
            device,
        )
        try:
            self._model = SentenceTransformer(settings.embedding_model, device=device)
        except Exception:
            logger.exception("Failed to load embedding model %s", settings.embedding_model)
            raise

        self._dim = self._model.get_embedding_dimension()
        logger.info("Embedding model loaded — dim=%d", self._dim)

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
        with self._conn.cursor() as cur:
            cur.execute("CREATE EXTENSION IF NOT EXISTS vector")
            cur.execute(f"""
                CREATE TABLE IF NOT EXISTS chunks (
                    id           TEXT PRIMARY KEY,
                    source       TEXT NOT NULL,
                    heading      TEXT NOT NULL,
                    chunk_index  INTEGER NOT NULL,
                    page_no      INTEGER NOT NULL DEFAULT 1,
                    content      TEXT NOT NULL,
                    embedding    vector({self._dim})
                )
            """)
            cur.execute("""
                ALTER TABLE chunks ADD COLUMN IF NOT EXISTS page_no INTEGER NOT NULL DEFAULT 1
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS chunks_hnsw_idx
                ON chunks USING hnsw (embedding vector_cosine_ops)
            """)
        self._conn.commit()
        logger.debug("Schema ready")

    def ingest(self, md_path: Path) -> int:
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
        passages = [self.PASSAGE_PREFIX + c.text for c in chunks]
        try:
            embeddings: np.ndarray = self._model.encode(
                passages,
                batch_size=32,
                show_progress_bar=False,
                convert_to_numpy=True,
            )
        except Exception:
            logger.exception("Embedding failed for %s", md_path.name)
            raise

        with self._conn.cursor() as cur:
            cur.execute("DELETE FROM chunks WHERE source = %s", (md_path.name,))
            for chunk, emb in zip(chunks, embeddings, strict=True):
                cur.execute(
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
                )
        self._conn.commit()
        logger.info("Ingest complete — source=%s chunks=%d", md_path.name, len(chunks))
        return len(chunks)

    def search(self, query: str, n: int | None = None) -> list[dict]:
        k = n or self._settings.retrieval_top_k
        logger.info("Vector search — query=%r top_k=%d", query[:60], k)
        try:
            q_emb: np.ndarray = self._model.encode(
                [self.QUERY_PREFIX + query],
                convert_to_numpy=True,
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
                rows = cur.fetchall()
        except Exception:
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

    def documents(self) -> list[dict]:
        with self._conn.cursor() as cur:
            cur.execute("""
                SELECT source, COUNT(*) AS chunk_count
                FROM chunks
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
