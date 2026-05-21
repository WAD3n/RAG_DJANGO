from django.urls import path

from . import views

urlpatterns = [
    path("upload/", views.UploadView.as_view()),
    path("convert/", views.ConvertView.as_view()),
    path("ingest/", views.IngestView.as_view()),
    path("query/", views.QueryView.as_view()),
    path("stats/", views.StatsView.as_view()),
    path("storage/", views.StorageListView.as_view()),
]
