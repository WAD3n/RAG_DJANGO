"""
Module-level singletons — loaded once at app startup, reused across all requests.

Initialisation order:
  1. Settings  (fast, just reads .env)
  2. VectorStore  (loads embedding model + connects to PostgreSQL)
  3. LLM  (loads transformers model or creates HTTP client)
  4. StorageClient  (MinIO/S3 — lightweight)
  5. DocumentConverter  (lazy — loaded on first /convert call)
  6. KafkaProducer  (lazy — created on first publish)
"""

import asyncio
import logging
import threading

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_initialized = False

_settings = None
_vector_store = None
_llm = None
_storage = None
_producer = None
_converter = None


def _load() -> None:
    global _settings, _vector_store, _llm, _storage

    logger.info("Loading Settings")
    from core.config import Settings
    _settings = Settings()
    _settings.log_summary()

    logger.info("Loading VectorStore")
    from core.vectorstore import VectorStore
    _vector_store = VectorStore(_settings)

    backend = "local" if _settings.use_local_llm else _settings.llm_backend
    if backend == "azure":
        logger.info("Loading AzureOpenAIClient — endpoint=%s", _settings.azure_endpoint)
        from core.azure_llm import AzureOpenAIClient
        _llm = AzureOpenAIClient(_settings)
    elif backend == "vllm":
        logger.info("Loading VLLMClient — base_url=%s", _settings.vllm_base_url)
        from core.llm import VLLMClient
        _llm = VLLMClient(_settings)
    else:
        logger.info("Loading LocalLLMClient — model=%s", _settings.local_llm_model)
        from core.local_llm import LocalLLMClient
        _llm = LocalLLMClient(_settings)

    logger.info("Loading StorageClient")
    from core.storage import StorageClient
    _storage = StorageClient(_settings)

    logger.info("All core services ready")


def init_all() -> None:
    global _initialized
    if _initialized:
        return
    with _lock:
        if _initialized:
            return
        try:
            _load()
            _initialized = True
            logger.info("Service initialisation complete")
        except Exception:
            logger.exception("Service initialisation failed")
            raise


# ---------------------------------------------------------------------------
# Accessors — trigger lazy init if needed
# ---------------------------------------------------------------------------

def get_settings():
    if not _initialized:
        init_all()
    return _settings


def get_vector_store():
    if not _initialized:
        init_all()
    return _vector_store


def get_llm():
    if not _initialized:
        init_all()
    return _llm


def get_storage():
    if not _initialized:
        init_all()
    return _storage


def get_producer():
    """Lazy — Kafka producer created on first publish."""
    global _producer
    if _producer is None:
        with _lock:
            if _producer is None:
                import json

                from kafka import KafkaProducer
                cfg = get_settings()
                logger.info(
                    "Creating KafkaProducer — servers=%s", cfg.kafka_bootstrap_servers
                )
                try:
                    _producer = KafkaProducer(
                        bootstrap_servers=cfg.kafka_bootstrap_servers,
                        value_serializer=lambda v: json.dumps(v).encode("utf-8"),
                        retries=3,
                        request_timeout_ms=5000,
                    )
                    logger.info("KafkaProducer ready")
                except Exception:
                    logger.exception("Failed to create KafkaProducer")
                    raise
    return _producer


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
    get_producer().flush()
    try:
        meta = future.get(timeout=10)
        logger.debug(
            "Kafka delivered — topic=%s partition=%d offset=%d object=%s",
            meta.topic, meta.partition, meta.offset, object_name,
        )
    except Exception:
        logger.exception("Kafka delivery failed — object=%s", object_name)
        raise


def get_converter():
    """Lazy — DocumentConverter loaded on first /convert call."""
    global _converter
    if _converter is None:
        with _lock:
            if _converter is None:
                logger.info("Loading DocumentConverter (lazy)")
                from core.converter import build_document_converter
                try:
                    _converter = build_document_converter(get_settings())
                    logger.info("DocumentConverter ready")
                except Exception:
                    logger.exception("Failed to build DocumentConverter")
                    raise
    return _converter


def run_llm(prompt: str, system: str = "", model: str | None = None) -> str:
    """Sync wrapper around the async complete() interface."""
    logger.debug("run_llm — prompt_len=%d model=%s", len(prompt), model)
    return asyncio.run(get_llm().complete(prompt, system, model=model))


def available_models() -> dict:
    """Return backend name and list of selectable model/deployment IDs."""
    cfg = get_settings()
    backend = "local" if cfg.use_local_llm else cfg.llm_backend
    if backend == "azure":
        return {"backend": "azure", "active": cfg.azure_deployment, "models": cfg.azure_deployments}
    if backend == "vllm":
        return {"backend": "vllm", "active": cfg.vllm_model, "models": [cfg.vllm_model]}
    return {"backend": "local", "active": cfg.local_llm_model, "models": [cfg.local_llm_model]}
