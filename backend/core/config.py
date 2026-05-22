import logging
from enum import StrEnum
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)

# Locate .env relative to project root (two levels above this file: backend/core/ → root)
_ENV_FILE = Path(__file__).parent.parent.parent / ".env"


class OcrEngine(StrEnum):
    EASYOCR = "easyocr"
    TESSERACT = "tesseract"
    TESSERACT_CLI = "tesseract_cli"
    RAPIDOCR = "rapidocr"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE),
        env_file_encoding="utf-8",
    )

    # Accelerator: auto | cuda | cpu
    device: str = "auto"

    # OCR
    ocr_engine: OcrEngine = OcrEngine.EASYOCR
    ocr_languages: list[str] = Field(default=["en", "pl"])

    # LLM backend: local | vllm | azure
    llm_backend: str = "local"
    use_local_llm: bool = False  # legacy alias — overrides llm_backend to "local" when True

    # local (HuggingFace transformers)
    local_llm_model: str = "Qwen/Qwen2.5-0.5B-Instruct"

    # vLLM / Ollama OpenAI-compatible server
    vllm_base_url: str = "http://localhost:8000/v1"
    vllm_model: str = "Qwen/Qwen2.5-0.5B-Instruct"
    vllm_api_key: str = "EMPTY"
    vllm_max_tokens: int = 2048
    vllm_temperature: float = 0.1
    vllm_timeout: float = 120.0

    # Azure OpenAI
    azure_endpoint: str = ""
    azure_api_key: str = ""
    azure_api_version: str = "2024-12-01-preview"
    azure_deployment: str = "gpt-5.4"
    azure_deployments: list[str] = Field(default=["gpt-5.4"])

    # VLM pipeline (Qwen2.5-VL-3B-Instruct)
    use_vlm: bool = False
    vlm_load_in_8bit: bool = False
    vlm_flash_attention2: bool = False

    # Embeddings — local (SentenceTransformer)
    embedding_model: str = "sdadas/mmlw-retrieval-roberta-large"
    chunk_size: int = 400
    chunk_overlap: int = 40
    retrieval_top_k: int = 5

    # Embeddings — remote OpenAI-compatible endpoint (e.g. vLLM)
    # When set, the remote API is used instead of the local SentenceTransformer.
    remote_embed_base_url: str = ""
    remote_embed_model: str = "nomic-ai/nomic-embed-text-v1.5"
    remote_embed_api_key: str = "EMPTY"
    remote_embed_dim: int = 768  # output dimension of the remote model (nomic-embed-text-v1.5 = 768)

    # PostgreSQL / pgvector
    pg_dsn: str = "postgresql://ragdocs:ragdocs@localhost:5432/ragdocs"

    # MinIO / S3
    minio_endpoint: str = "http://localhost:9000"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin"
    minio_bucket: str = "ragdocs"

    # Kafka
    kafka_bootstrap_servers: list[str] = Field(default=["localhost:9094"])
    kafka_topic_file_uploaded: str = "rag.file.uploaded"
    kafka_consumer_group: str = "rag-pipeline"

    def log_summary(self) -> None:
        logger.info(
            "Settings loaded — device=%s ocr=%s llm=%s embed=%s",
            self.device,
            self.ocr_engine.value,
            self.local_llm_model if self.use_local_llm else self.vllm_model,
            self.embedding_model,
        )
