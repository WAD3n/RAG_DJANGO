"""
MinIO / S3-compatible object storage client.

Bucket layout:
  originals/<filename>   — uploaded source documents (PDF, DOCX, …)
  converted/<stem>.md    — converted markdown files
"""

import io
import logging
from pathlib import Path

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

from core.config import Settings

logger = logging.getLogger(__name__)


class StorageClient:
    def __init__(self, settings: Settings) -> None:
        self._bucket = settings.minio_bucket
        self._public_endpoint = settings.minio_public_endpoint or settings.minio_endpoint
        logger.info(
            "Connecting to MinIO — endpoint=%s bucket=%s",
            settings.minio_endpoint,
            self._bucket,
        )
        self._client = boto3.client(
            "s3",
            endpoint_url=settings.minio_endpoint,
            aws_access_key_id=settings.minio_access_key,
            aws_secret_access_key=settings.minio_secret_key,
            config=Config(signature_version="s3v4"),
        )
        self._public_client = boto3.client(
            "s3",
            endpoint_url=self._public_endpoint,
            aws_access_key_id=settings.minio_access_key,
            aws_secret_access_key=settings.minio_secret_key,
            config=Config(signature_version="s3v4"),
        ) if self._public_endpoint != settings.minio_endpoint else self._client
        self._ensure_bucket()

    def _ensure_bucket(self) -> None:
        try:
            self._client.head_bucket(Bucket=self._bucket)
            logger.debug("Bucket '%s' exists", self._bucket)
        except ClientError:
            logger.info("Bucket '%s' not found — creating", self._bucket)
            self._client.create_bucket(Bucket=self._bucket)

    def upload_file(self, file_path: Path, prefix: str = "originals") -> str:
        key = f"{prefix}/{file_path.name}"
        logger.info("Uploading file — src=%s key=%s", file_path, key)
        try:
            self._client.upload_file(str(file_path), self._bucket, key)
            logger.debug("Upload complete — key=%s", key)
            return key
        except Exception:
            logger.exception("Failed to upload file %s", file_path)
            raise

    def upload_bytes(
        self, data: bytes, object_name: str, content_type: str = "application/octet-stream"
    ) -> str:
        logger.info("Uploading bytes — key=%s size=%d", object_name, len(data))
        try:
            self._client.upload_fileobj(
                io.BytesIO(data),
                self._bucket,
                object_name,
                ExtraArgs={"ContentType": content_type},
            )
            logger.debug("Upload bytes complete — key=%s", object_name)
            return object_name
        except Exception:
            logger.exception("Failed to upload bytes to %s", object_name)
            raise

    def download_file(self, object_name: str, dest_path: Path) -> None:
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        logger.info("Downloading — key=%s dest=%s", object_name, dest_path)
        try:
            self._client.download_file(self._bucket, object_name, str(dest_path))
            logger.debug("Download complete — dest=%s", dest_path)
        except Exception:
            logger.exception("Failed to download %s", object_name)
            raise

    def download_bytes(self, object_name: str) -> bytes:
        logger.debug("Downloading bytes — key=%s", object_name)
        try:
            buf = io.BytesIO()
            self._client.download_fileobj(self._bucket, object_name, buf)
            data = buf.getvalue()
            logger.debug("Download bytes complete — key=%s size=%d", object_name, len(data))
            return data
        except Exception:
            logger.exception("Failed to download bytes from %s", object_name)
            raise

    def presigned_url(self, object_name: str, expires: int = 3600) -> str:
        logger.debug("Generating presigned URL — key=%s expires=%ds", object_name, expires)
        return self._public_client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self._bucket, "Key": object_name},
            ExpiresIn=expires,
        )

    def delete_object(self, object_name: str) -> None:
        logger.info("Deleting object — key=%s", object_name)
        try:
            self._client.delete_object(Bucket=self._bucket, Key=object_name)
        except Exception:
            logger.exception("Failed to delete object %s", object_name)
            raise

    def list_objects(self, prefix: str = "") -> list[str]:
        logger.debug("Listing objects — prefix=%r", prefix)
        response = self._client.list_objects_v2(Bucket=self._bucket, Prefix=prefix)
        keys = [obj["Key"] for obj in response.get("Contents", [])]
        logger.debug("Listed %d objects with prefix=%r", len(keys), prefix)
        return keys

    def exists(self, object_name: str) -> bool:
        try:
            self._client.head_object(Bucket=self._bucket, Key=object_name)
            return True
        except ClientError:
            return False
