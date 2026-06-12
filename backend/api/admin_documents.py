"""Staff-only views for managing vectorstore documents — mounted at /admin/documents/."""

from pathlib import Path

from django.contrib import messages as django_messages
from django.contrib.admin.views.decorators import staff_member_required
from django.http import HttpResponseRedirect
from django.shortcuts import render

from .models import DocumentSummary, Workspace


def _delete_document(source: str, workspace_id: int | None) -> None:
    from api import services

    ws_prefix = str(workspace_id) if workspace_id is not None else "global"
    stem = Path(source).stem
    storage = services.get_storage()

    services.get_vector_store().delete(source, workspace_id=workspace_id)

    for key in storage.list_objects(prefix=f"originals/{ws_prefix}/"):
        if Path(key).stem == stem:
            try:
                storage.delete_object(key)
            except Exception:
                pass

    try:
        storage.delete_object(f"converted/{ws_prefix}/{stem}.md")
    except Exception:
        pass

    DocumentSummary.objects.filter(source=source, workspace_id=workspace_id).delete()


@staff_member_required
def document_list(request):
    from api import services

    workspace_id_raw = request.GET.get("workspace_id", "")
    workspace_id = int(workspace_id_raw) if workspace_id_raw else None
    workspaces = Workspace.objects.all().order_by("name")

    docs = []
    error = None
    try:
        raw_docs = services.get_vector_store().documents(workspace_id=workspace_id)
        storage = services.get_storage()
        ws_prefix = str(workspace_id) if workspace_id is not None else "global"
        originals = {
            Path(k).stem: k
            for k in storage.list_objects(prefix=f"originals/{ws_prefix}/")
        }
        for d in raw_docs:
            stem = Path(d["source"]).stem
            docs.append({
                "source": d["source"],
                "chunks": d["chunks"],
                "original_key": originals.get(stem, ""),
            })
    except Exception as exc:
        error = str(exc)

    return render(request, "admin/api/documents/list.html", {
        "title": "Vectorstore documents",
        "docs": docs,
        "workspaces": workspaces,
        "selected_ws": workspace_id,
        "selected_ws_raw": workspace_id_raw,
        "error": error,
    })


@staff_member_required
def document_delete(request):
    if request.method != "POST":
        return HttpResponseRedirect("../")

    source = request.POST.get("source", "").strip()
    workspace_id_raw = request.POST.get("workspace_id", "").strip()
    workspace_id = int(workspace_id_raw) if workspace_id_raw else None

    if not source:
        django_messages.error(request, "No source provided.")
        return HttpResponseRedirect("../")

    try:
        _delete_document(source, workspace_id)
        django_messages.success(request, f"Deleted: {source}")
    except Exception as exc:
        django_messages.error(request, f"Error deleting {source}: {exc}")

    qs = f"?workspace_id={workspace_id_raw}" if workspace_id_raw else ""
    return HttpResponseRedirect(f"../{qs}")
