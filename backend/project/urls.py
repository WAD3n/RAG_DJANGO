from django.contrib import admin
from django.urls import include, path

from api.admin_documents import document_delete, document_list

urlpatterns = [
    path("admin/", admin.site.urls),
    path("admin/documents/", document_list),
    path("admin/documents/delete/", document_delete),
    path("", include("django_prometheus.urls")),
    path("api/", include("api.urls")),
]
