"""
Kafka consumer — RAG pipeline worker.

Listens on topic `rag.file.uploaded`, then for each message:
  1. Downloads original file from MinIO
  2. Converts to Markdown via docling
  3. Uploads converted Markdown back to MinIO  (converted/<stem>.md)
  4. Chunks + embeds into PostgreSQL/pgvector

Run alongside the API server:
    python manage.py run_consumer
"""

import json
import logging
import shutil
import tempfile
from pathlib import Path

from django.core.management.base import BaseCommand

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = "Run the Kafka consumer for the automated RAG pipeline."

    def handle(self, *args, **options):
        from kafka import KafkaConsumer
        from kafka.errors import NoBrokersAvailable

        from core.config import Settings
        from core.converter import build_document_converter
        from core.storage import StorageClient
        from core.vectorstore import VectorStore

        cfg = Settings()
        logger.info("Consumer starting — topic=%s group=%s", cfg.kafka_topic_file_uploaded, cfg.kafka_consumer_group)
        self.stdout.write("Loading models…")

        try:
            storage = StorageClient(cfg)
            converter = build_document_converter(cfg)
            store = VectorStore(cfg)
            import asyncio as _asyncio
            _backend = "local" if cfg.use_local_llm else cfg.llm_backend
            if _backend == "azure":
                from core.azure_llm import AzureOpenAIClient
                llm = AzureOpenAIClient(cfg)
            elif _backend == "vllm":
                from core.llm import VLLMClient
                llm = VLLMClient(cfg)
            else:
                from core.local_llm import LocalLLMClient
                llm = LocalLLMClient(cfg)
        except Exception:
            logger.exception("Failed to load models")
            self.stderr.write(self.style.ERROR("Model loading failed — check logs"))
            return

        self.stdout.write(self.style.SUCCESS("Models ready."))

        try:
            consumer = KafkaConsumer(
                cfg.kafka_topic_file_uploaded,
                bootstrap_servers=cfg.kafka_bootstrap_servers,
                group_id=cfg.kafka_consumer_group,
                auto_offset_reset="earliest",
                enable_auto_commit=True,
                value_deserializer=lambda m: json.loads(m.decode("utf-8")),
                max_poll_interval_ms=3600000,  # 1h — OCR on CPU can take minutes
                session_timeout_ms=60000,
                heartbeat_interval_ms=20000,
            )
        except NoBrokersAvailable:
            logger.error("Cannot connect to Kafka brokers: %s", cfg.kafka_bootstrap_servers)
            self.stderr.write(self.style.ERROR(
                "Cannot connect to Kafka. Is 'docker compose up -d' running?"
            ))
            return

        logger.info(
            "Listening on topic '%s' (group: %s)",
            cfg.kafka_topic_file_uploaded,
            cfg.kafka_consumer_group,
        )
        self.stdout.write(
            f"Listening on topic '{cfg.kafka_topic_file_uploaded}' "
            f"(group: {cfg.kafka_consumer_group}) …"
        )

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
                markdown = result.document.export_to_markdown(page_break_placeholder="\f")
                logger.info("Converted — source=%s chars=%d", filename, len(markdown))
                self.stdout.write(f"    Converted   {len(markdown):,} chars")

                out = Path(tmp_dir) / f"{file_path.stem}.md"
                out.write_text(markdown, encoding="utf-8")

                ws_prefix = str(workspace_id) if workspace_id is not None else "global"
                md_key = f"converted/{ws_prefix}/{file_path.stem}.md"
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

                if workspace_id is not None and file_size_bytes >= cfg.summary_min_size_bytes:
                    from api.models import DocumentSummary
                    self.stdout.write("    Summarizing...")
                    summary_text = _asyncio.run(llm.complete(
                        prompt=f"Summarize the following document in 3-5 sentences:\n\n{markdown[:8000]}",
                        system="You are a document summarization assistant. Respond in English.",
                    ))
                    md_name = out.name
                    DocumentSummary.objects.update_or_create(
                        workspace_id=workspace_id,
                        source=md_name,
                        defaults={"summary": summary_text, "file_size_bytes": file_size_bytes},
                    )
                    logger.info("Summary saved — source=%s workspace_id=%s", md_name, workspace_id)
                    self.stdout.write(self.style.SUCCESS(f"    Summarized  {md_name}"))

            except Exception:
                logger.exception("Pipeline failed for object=%s", object_name)
                self.stderr.write(self.style.ERROR("    ERROR — see logs for details"))

            finally:
                shutil.rmtree(tmp_dir, ignore_errors=True)
