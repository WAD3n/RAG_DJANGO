import logging
import tempfile
from pathlib import Path

from rest_framework import status
from rest_framework.parsers import JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from . import services
from .serializers import ConvertRequestSerializer, IngestRequestSerializer, QueryRequestSerializer

logger = logging.getLogger(__name__)


class UploadView(APIView):
    """POST /api/upload/ — stores the original file in MinIO."""

    parser_classes = [MultiPartParser]

    def post(self, request):
        file = request.FILES.get("file")
        if not file:
            logger.warning("UploadView — no file in request")
            return Response(
                {"error": "No file provided (field: 'file')"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        object_name = f"originals/{file.name}"
        logger.info("UploadView — file=%s size=%d", file.name, file.size)
        try:
            services.get_storage().upload_bytes(
                data=file.read(),
                object_name=object_name,
                content_type=file.content_type or "application/octet-stream",
            )

            pipeline_triggered = True
            try:
                services.publish_file_uploaded(object_name, file.name)
            except Exception:
                logger.exception("Kafka publish failed for %s — pipeline not triggered", object_name)
                pipeline_triggered = False

            logger.info("UploadView complete — object=%s pipeline=%s", object_name, pipeline_triggered)
            return Response(
                {
                    "object_name": object_name,
                    "filename": file.name,
                    "size": file.size,
                    "download_url": services.get_storage().presigned_url(object_name),
                    "pipeline_triggered": pipeline_triggered,
                },
                status=status.HTTP_201_CREATED,
            )
        except Exception:
            logger.exception("UploadView failed for %s", file.name)
            return Response({"error": "Upload failed"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class ConvertView(APIView):
    """POST /api/convert/ — convert a document to Markdown."""

    parser_classes = [JSONParser]

    def post(self, request):
        ser = ConvertRequestSerializer(data=request.data)
        if not ser.is_valid():
            logger.warning("ConvertView — invalid request: %s", ser.errors)
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

        object_name = ser.validated_data.get("object_name")
        file_path_str = ser.validated_data.get("file_path")
        query = ser.validated_data.get("query")

        logger.info("ConvertView — object=%s file=%s", object_name, file_path_str)
        tmp_dir = None
        try:
            tmp_dir = tempfile.mkdtemp()
            if object_name:
                file_path = Path(tmp_dir) / Path(object_name).name
                services.get_storage().download_file(object_name, file_path)
            else:
                file_path = Path(file_path_str)
                if not file_path.exists():
                    logger.warning("ConvertView — file not found: %s", file_path)
                    return Response(
                        {"error": f"File not found: {file_path}"},
                        status=status.HTTP_404_NOT_FOUND,
                    )

            converter = services.get_converter()
            result = converter.convert(str(file_path))
            markdown = result.document.export_to_markdown()
            logger.info("ConvertView — converted %d chars from %s", len(markdown), file_path.name)

            md_key = services.get_storage().upload_bytes(
                data=markdown.encode("utf-8"),
                object_name=f"converted/{file_path.stem}.md",
                content_type="text/markdown",
            )

            response_data = {
                "minio_key": md_key,
                "download_url": services.get_storage().presigned_url(md_key),
                "preview": markdown[:500],
            }

            if query:
                logger.info("ConvertView — running LLM query on converted document")
                response_data["answer"] = services.run_llm(
                    prompt=f"Document:\n\n{markdown}\n\nQuestion: {query}",
                    system="You are a document analysis assistant. Answer only based on the provided document content.",
                )

            return Response(response_data, status=status.HTTP_200_OK)

        except Exception:
            logger.exception("ConvertView failed for object=%s file=%s", object_name, file_path_str)
            return Response({"error": "Conversion failed"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        finally:
            if tmp_dir:
                import shutil
                shutil.rmtree(tmp_dir, ignore_errors=True)


class IngestView(APIView):
    """POST /api/ingest/ — chunk and embed a Markdown file from MinIO into the vector store."""

    def post(self, request):
        ser = IngestRequestSerializer(data=request.data)
        if not ser.is_valid():
            logger.warning("IngestView — invalid request: %s", ser.errors)
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

        minio_key = ser.validated_data["minio_key"]
        logger.info("IngestView — minio_key=%s", minio_key)

        tmp_dir = None
        try:
            md_path = Path(tempfile.mkdtemp())
            tmp_dir = str(md_path)
            md_path = md_path / Path(minio_key).name
            services.get_storage().download_file(minio_key, md_path)
            n = services.get_vector_store().ingest(md_path)
            logger.info("IngestView complete — source=%s chunks=%d", md_path.name, n)
            return Response({"source": md_path.name, "chunks": n}, status=status.HTTP_200_OK)
        except Exception:
            logger.exception("IngestView failed for %s", minio_key)
            return Response({"error": "Ingest failed"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        finally:
            if tmp_dir:
                import shutil
                shutil.rmtree(tmp_dir, ignore_errors=True)


class QueryView(APIView):
    """POST /api/query/ — retrieve relevant chunks and generate an answer."""

    def post(self, request):
        ser = QueryRequestSerializer(data=request.data)
        if not ser.is_valid():
            logger.warning("QueryView — invalid request: %s", ser.errors)
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

        question = ser.validated_data["question"]
        top_k = ser.validated_data.get("top_k")
        logger.info("QueryView — question=%r top_k=%s", question[:80], top_k)

        try:
            store = services.get_vector_store()
            stats = store.stats()
            if stats["total_chunks"] == 0:
                logger.warning("QueryView — vector store is empty")
                return Response(
                    {"error": "Vector store is empty. Run /api/ingest/ first."},
                    status=status.HTTP_422_UNPROCESSABLE_ENTITY,
                )

            hits = store.search(question, n=top_k)
            context = "\n\n---\n\n".join(
                f"[{h['source']} / {h['heading']}]\n{h['text']}" for h in hits
            )
            answer = services.run_llm(
                prompt=f"Context fragments:\n\n{context}\n\nQuestion: {question}",
                system=(
                    "You are a document analysis assistant. "
                    "Answer the question using only the provided context fragments. "
                    "If the answer is not contained in the fragments, say so explicitly."
                ),
            )
            logger.info("QueryView complete — hits=%d answer_len=%d", len(hits), len(answer))
            return Response({"answer": answer, "context": hits}, status=status.HTTP_200_OK)

        except Exception:
            logger.exception("QueryView failed for question=%r", question[:80])
            return Response({"error": "Query failed"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class StatsView(APIView):
    """GET /api/stats/ — vector store statistics."""

    def get(self, request):
        logger.debug("StatsView")
        try:
            return Response(services.get_vector_store().stats(), status=status.HTTP_200_OK)
        except Exception:
            logger.exception("StatsView failed")
            return Response({"error": "Stats unavailable"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class StorageListView(APIView):
    """GET /api/storage/?prefix= — list objects in MinIO."""

    def get(self, request):
        prefix = request.query_params.get("prefix", "")
        logger.debug("StorageListView — prefix=%r", prefix)
        try:
            storage = services.get_storage()
            keys = storage.list_objects(prefix=prefix)
            items = [
                {
                    "key": k,
                    "download_url": storage.presigned_url(k),
                }
                for k in keys
            ]
            return Response(items, status=status.HTTP_200_OK)
        except Exception:
            logger.exception("StorageListView failed for prefix=%r", prefix)
            return Response({"error": "Storage list failed"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
