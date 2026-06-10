import logging
import tempfile
from pathlib import Path

from django.contrib.auth import authenticate
from django.db.models import Count
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.parsers import JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from . import services
from .models import Conversation, Message, Workspace, WorkspaceMembership
from .serializers import ConvertRequestSerializer, IngestRequestSerializer, QueryRequestSerializer

logger = logging.getLogger(__name__)


class LoginView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    parser_classes = [JSONParser]

    def post(self, request):
        username = request.data.get("username", "").strip()
        password = request.data.get("password", "")
        if not username or not password:
            return Response(
                {"error": "Username and password required"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user = authenticate(request, username=username, password=password)
        if not user:
            logger.warning("LoginView — failed login for username=%r", username)
            return Response({"error": "Invalid credentials"}, status=status.HTTP_401_UNAUTHORIZED)
        token, _ = Token.objects.get_or_create(user=user)
        # Auto-create "default" workspace for new users
        if not Workspace.objects.filter(members=user).exists():
            from django.utils.text import slugify
            slug = f"default-{slugify(user.username)}"
            ws, _ = Workspace.objects.get_or_create(slug=slug, defaults={"name": "default"})
            WorkspaceMembership.objects.get_or_create(user=user, workspace=ws)
            logger.info("LoginView — created default workspace for user=%s", username)
        logger.info("LoginView — user=%s logged in", username)
        return Response({"token": token.key, "username": user.username})


class LogoutView(APIView):
    def post(self, request):
        try:
            request.user.auth_token.delete()
        except Exception:
            pass
        logger.info("LogoutView — user=%s logged out", request.user.username)
        return Response(status=status.HTTP_204_NO_CONTENT)


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

        workspace_id = request.data.get("workspace_id")
        if workspace_id:
            try:
                workspace_id = int(workspace_id)
                if not Workspace.objects.filter(id=workspace_id, members=request.user).exists():
                    return Response(
                        {"error": "Workspace not found or access denied"},
                        status=status.HTTP_403_FORBIDDEN,
                    )
            except (ValueError, TypeError):
                return Response({"error": "Invalid workspace_id"}, status=status.HTTP_400_BAD_REQUEST)

        ws_prefix = str(workspace_id) if workspace_id is not None else "global"
        object_name = f"originals/{ws_prefix}/{file.name}"
        logger.info("UploadView — file=%s size=%d workspace_id=%s", file.name, file.size, workspace_id)
        try:
            services.get_storage().upload_bytes(
                data=file.read(),
                object_name=object_name,
                content_type=file.content_type or "application/octet-stream",
            )

            pipeline_triggered = True
            try:
                services.publish_file_uploaded(object_name, file.name, workspace_id=workspace_id, file_size_bytes=file.size)
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
            markdown = result.document.export_to_markdown(page_break_placeholder="\f")
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
        model = ser.validated_data.get("model") or None
        workspace_id = ser.validated_data.get("workspace_id")
        logger.info("QueryView — question=%r top_k=%s model=%s workspace_id=%s", question[:80], top_k, model, workspace_id)

        try:
            store = services.get_vector_store()
            stats = store.stats()
            if stats["total_chunks"] == 0:
                logger.warning("QueryView — vector store is empty")
                return Response(
                    {"error": "Vector store is empty. Run /api/ingest/ first."},
                    status=status.HTTP_422_UNPROCESSABLE_ENTITY,
                )

            hits = store.search(question, n=top_k, workspace_id=workspace_id)
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
                model=model,
            )

            import json as _json
            judge_result = None
            judge_prompt = (
                f"Context fragments:\n{context}\n\n"
                f"Question: {question}\nAnswer: {answer}\n\n"
                "Evaluate the answer. Return JSON only:\n"
                '{"verdict": "PASS|WARN|FAIL", "score": 1-10, '
                '"reasoning": "<one sentence>", '
                '"flags": ["hallucination"|"incomplete"|"off_topic"]}'
            )
            try:
                judge_raw = services.run_llm(
                    prompt=judge_prompt,
                    system="You are an answer quality evaluator. Return only valid JSON, no other text.",
                )
                judge_result = _json.loads(judge_raw)
                logger.info("Judge — verdict=%s score=%s", judge_result.get("verdict"), judge_result.get("score"))
            except Exception:
                logger.warning("Judge failed or returned unparseable JSON", exc_info=True)

            logger.info("QueryView complete — hits=%d answer_len=%d", len(hits), len(answer))
            return Response({"answer": answer, "context": hits, "judge": judge_result}, status=status.HTTP_200_OK)

        except Exception:
            logger.exception("QueryView failed for question=%r", question[:80])
            return Response({"error": "Query failed"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class PdfViewView(APIView):
    """GET /api/pdf/view?key=originals/... — serve original file inline for browser PDF viewer."""

    def get(self, request):
        import mimetypes
        from django.http import HttpResponse

        key = request.query_params.get("key", "")
        if not key.startswith("originals/"):
            return Response({"error": "Invalid key"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            data = services.get_storage().download_bytes(key)
        except Exception:
            logger.exception("PdfViewView — not found: %s", key)
            return Response({"error": "File not found"}, status=status.HTTP_404_NOT_FOUND)

        content_type, _ = mimetypes.guess_type(key)
        response = HttpResponse(data, content_type=content_type or "application/octet-stream")
        response["Content-Disposition"] = f'inline; filename="{Path(key).name}"'
        return response


class DocumentSummaryView(APIView):
    """GET /api/documents/summary/?source=<md>&workspace_id=<id>"""

    def get(self, request):
        from .models import DocumentSummary
        source = request.query_params.get("source", "")
        workspace_id = request.query_params.get("workspace_id")
        if not source or not workspace_id:
            return Response(
                {"error": "source and workspace_id required"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            workspace_id = int(workspace_id)
        except ValueError:
            return Response({"error": "Invalid workspace_id"}, status=status.HTTP_400_BAD_REQUEST)

        if not Workspace.objects.filter(id=workspace_id, members=request.user).exists():
            return Response({"error": "Access denied"}, status=status.HTTP_403_FORBIDDEN)

        try:
            s = DocumentSummary.objects.get(workspace_id=workspace_id, source=source)
        except DocumentSummary.DoesNotExist:
            return Response({"error": "No summary found"}, status=status.HTTP_404_NOT_FOUND)

        return Response({
            "source": s.source,
            "summary": s.summary,
            "file_size_bytes": s.file_size_bytes,
            "generated_at": s.generated_at.isoformat(),
        })


class DocumentsView(APIView):
    """GET /api/documents — indexed documents with per-doc chunk counts."""

    def get(self, request):
        workspace_id = request.query_params.get("workspace_id")
        if workspace_id:
            try:
                workspace_id = int(workspace_id)
            except ValueError:
                workspace_id = None
        try:
            vs_docs = services.get_vector_store().documents(workspace_id=workspace_id)

            try:
                ws_prefix = str(workspace_id) if workspace_id is not None else "global"
                originals = services.get_storage().list_objects(prefix=f"originals/{ws_prefix}/")
                if not originals:
                    originals = services.get_storage().list_objects(prefix="originals/")
                    originals = [k for k in originals if "/" not in k[len("originals/"):]]
                orig_map = {
                    Path(key).stem: {"key": key, "ext": Path(key).suffix.lstrip(".")}
                    for key in originals
                }
            except Exception:
                logger.warning("DocumentsView — could not list originals from MinIO")
                orig_map = {}

            result = []
            for doc in vs_docs:
                stem = Path(doc["source"]).stem
                orig = orig_map.get(stem, {})
                result.append({
                    "source": doc["source"],
                    "name": stem,
                    "chunks": doc["chunks"],
                    "original_key": orig.get("key"),
                    "original_ext": orig.get("ext"),
                })

            return Response(result, status=status.HTTP_200_OK)
        except Exception:
            logger.exception("DocumentsView failed")
            return Response({"error": "Failed to list documents"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class DocumentDeleteView(APIView):
    """DELETE /api/documents/delete?source=doc.md&workspace_id=3&original_key=originals/3/doc.pdf"""

    def delete(self, request):
        source = request.query_params.get("source", "").strip()
        original_key = request.query_params.get("original_key", "").strip()
        workspace_id_raw = request.query_params.get("workspace_id")

        if not source:
            return Response({"error": "source required"}, status=status.HTTP_400_BAD_REQUEST)

        workspace_id = None
        if workspace_id_raw:
            try:
                workspace_id = int(workspace_id_raw)
            except (ValueError, TypeError):
                return Response({"error": "Invalid workspace_id"}, status=status.HTTP_400_BAD_REQUEST)
            if not request.user.is_staff:
                if not Workspace.objects.filter(id=workspace_id, members=request.user).exists():
                    return Response({"error": "Access denied"}, status=status.HTTP_403_FORBIDDEN)

        try:
            deleted_chunks = services.get_vector_store().delete(source, workspace_id=workspace_id)
        except Exception:
            logger.exception("DocumentDeleteView — failed to delete chunks for source=%s", source)
            return Response({"error": "Failed to delete chunks"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        storage = services.get_storage()
        if original_key and original_key.startswith("originals/"):
            try:
                storage.delete_object(original_key)
            except Exception:
                logger.warning("DocumentDeleteView — could not delete original: %s", original_key)

        stem = Path(source).stem
        try:
            storage.delete_object(f"converted/{stem}.md")
        except Exception:
            pass

        logger.info("DocumentDeleteView — source=%s deleted_chunks=%d", source, deleted_chunks)
        return Response({"deleted_chunks": deleted_chunks}, status=status.HTTP_200_OK)


class ModelsView(APIView):
    """GET /api/models/ — available LLM models/deployments."""

    def get(self, request):
        try:
            return Response(services.available_models(), status=status.HTTP_200_OK)
        except Exception:
            logger.exception("ModelsView failed")
            return Response({"error": "Could not retrieve models"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


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


class WorkspaceListCreateView(APIView):
    """GET /api/workspaces — list user's workspaces; POST — create."""

    def get(self, request):
        from .serializers import WorkspaceSerializer
        workspaces = Workspace.objects.filter(members=request.user)
        return Response(WorkspaceSerializer(workspaces, many=True).data)

    def post(self, request):
        from .serializers import WorkspaceSerializer
        from django.utils.text import slugify
        name = (request.data.get("name") or "").strip()
        if not name:
            return Response({"error": "name required"}, status=status.HTTP_400_BAD_REQUEST)
        base_slug = slugify(f"{name}-{request.user.username}")
        slug = base_slug
        counter = 1
        while Workspace.objects.filter(slug=slug).exists():
            slug = f"{base_slug}-{counter}"
            counter += 1
        ws = Workspace.objects.create(name=name, slug=slug)
        WorkspaceMembership.objects.create(user=request.user, workspace=ws)
        return Response(WorkspaceSerializer(ws).data, status=status.HTTP_201_CREATED)


class WorkspaceDetailView(APIView):
    """PATCH /api/workspaces/<pk> — rename; DELETE — delete (owner only)."""

    def _get(self, request, pk):
        try:
            return Workspace.objects.get(pk=pk, members=request.user)
        except Workspace.DoesNotExist:
            return None

    def patch(self, request, pk):
        from .serializers import WorkspaceSerializer
        ws = self._get(request, pk)
        if ws is None:
            return Response({"error": "Not found"}, status=status.HTTP_404_NOT_FOUND)
        name = (request.data.get("name") or "").strip()
        if not name:
            return Response({"error": "name required"}, status=status.HTTP_400_BAD_REQUEST)
        ws.name = name
        ws.save(update_fields=["name"])
        return Response(WorkspaceSerializer(ws).data)

    def delete(self, request, pk):
        ws = self._get(request, pk)
        if ws is None:
            return Response({"error": "Not found"}, status=status.HTTP_404_NOT_FOUND)
        ws.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class WorkspaceMembersView(APIView):
    """POST /api/workspaces/<id>/members/ — add member (staff); DELETE .../<uid>/ — remove."""

    def _get_workspace(self, pk):
        try:
            return Workspace.objects.get(pk=pk)
        except Workspace.DoesNotExist:
            return None

    def post(self, request, pk):
        from django.contrib.auth.models import User as DjangoUser
        if not request.user.is_staff:
            return Response({"error": "Staff only"}, status=status.HTTP_403_FORBIDDEN)
        ws = self._get_workspace(pk)
        if ws is None:
            return Response({"error": "Workspace not found"}, status=status.HTTP_404_NOT_FOUND)
        user_id = request.data.get("user_id")
        try:
            target = DjangoUser.objects.get(pk=user_id)
        except DjangoUser.DoesNotExist:
            return Response({"error": "User not found"}, status=status.HTTP_404_NOT_FOUND)
        _, created = WorkspaceMembership.objects.get_or_create(user=target, workspace=ws)
        return Response(
            {"workspace_id": ws.id, "user_id": target.id, "created": created},
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    def delete(self, request, pk, user_id):
        if not request.user.is_staff:
            return Response({"error": "Staff only"}, status=status.HTTP_403_FORBIDDEN)
        ws = self._get_workspace(pk)
        if ws is None:
            return Response({"error": "Workspace not found"}, status=status.HTTP_404_NOT_FOUND)
        deleted, _ = WorkspaceMembership.objects.filter(workspace=ws, user_id=user_id).delete()
        if not deleted:
            return Response({"error": "Membership not found"}, status=status.HTTP_404_NOT_FOUND)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ConversationListCreateView(APIView):
    """GET /api/conversations — list user conversations; POST — create."""

    def get(self, request):
        convs = (
            Conversation.objects
            .filter(user=request.user)
            .annotate(message_count=Count("messages"))
        )
        return Response([
            {
                "id": c.id,
                "title": c.title,
                "created_at": c.created_at.isoformat(),
                "updated_at": c.updated_at.isoformat(),
                "message_count": c.message_count,
            }
            for c in convs
        ])

    def post(self, request):
        title = request.data.get("title", "New conversation") or "New conversation"
        conv = Conversation.objects.create(user=request.user, title=title)
        return Response(
            {
                "id": conv.id,
                "title": conv.title,
                "created_at": conv.created_at.isoformat(),
                "updated_at": conv.updated_at.isoformat(),
                "message_count": 0,
            },
            status=status.HTTP_201_CREATED,
        )


class ConversationDetailView(APIView):
    """PATCH /api/conversations/{pk} — rename; DELETE — delete."""

    def _get(self, request, pk):
        try:
            return Conversation.objects.get(pk=pk, user=request.user)
        except Conversation.DoesNotExist:
            return None

    def patch(self, request, pk):
        conv = self._get(request, pk)
        if conv is None:
            return Response({"error": "Not found"}, status=status.HTTP_404_NOT_FOUND)
        title = (request.data.get("title") or "").strip()
        if title:
            conv.title = title
            conv.save(update_fields=["title", "updated_at"])
        return Response({"id": conv.id, "title": conv.title})

    def delete(self, request, pk):
        conv = self._get(request, pk)
        if conv is None:
            return Response({"error": "Not found"}, status=status.HTTP_404_NOT_FOUND)
        conv.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class MessageListCreateView(APIView):
    """GET /api/conversations/{pk}/messages — list; POST — append one or many."""

    def _get_conv(self, request, pk):
        try:
            return Conversation.objects.get(pk=pk, user=request.user)
        except Conversation.DoesNotExist:
            return None

    def get(self, request, pk):
        conv = self._get_conv(request, pk)
        if conv is None:
            return Response({"error": "Not found"}, status=status.HTTP_404_NOT_FOUND)
        return Response([
            {
                "id": m.id,
                "role": m.role,
                "content": m.content,
                "citations": m.citations,
                "duration_ms": m.duration_ms,
                "judge_result": m.judge_result,
                "created_at": m.created_at.isoformat(),
            }
            for m in conv.messages.all()
        ])

    def post(self, request, pk):
        conv = self._get_conv(request, pk)
        if conv is None:
            return Response({"error": "Not found"}, status=status.HTTP_404_NOT_FOUND)

        payload = request.data
        messages_data = payload if isinstance(payload, list) else [payload]

        created = []
        for md in messages_data:
            role = md.get("role", "")
            if role not in ("user", "assistant"):
                return Response({"error": f"Invalid role: {role!r}"}, status=status.HTTP_400_BAD_REQUEST)
            m = Message.objects.create(
                conversation=conv,
                role=role,
                content=md.get("content", ""),
                citations=md.get("citations", []),
                duration_ms=md.get("duration_ms"),
                judge_result=md.get("judge_result"),
            )
            created.append({"id": m.id, "role": m.role})

        conv.save(update_fields=["updated_at"])
        return Response(created, status=status.HTTP_201_CREATED)
