from django.urls import path

from . import views

urlpatterns = [
    path("auth/login", views.LoginView.as_view()),
    path("auth/logout", views.LogoutView.as_view()),
    path("upload", views.UploadView.as_view()),
    path("convert", views.ConvertView.as_view()),
    path("ingest", views.IngestView.as_view()),
    path("query", views.QueryView.as_view()),
    path("pdf/view", views.PdfViewView.as_view()),
    path("documents/summary", views.DocumentSummaryView.as_view()),
    path("documents/delete", views.DocumentDeleteView.as_view()),
    path("documents", views.DocumentsView.as_view()),
    path("models", views.ModelsView.as_view()),
    path("stats", views.StatsView.as_view()),
    path("storage", views.StorageListView.as_view()),
    path("conversations", views.ConversationListCreateView.as_view()),
    path("conversations/<int:pk>", views.ConversationDetailView.as_view()),
    path("conversations/<int:pk>/messages", views.MessageListCreateView.as_view()),
    path("workspaces", views.WorkspaceListCreateView.as_view()),
    path("workspaces/<int:pk>", views.WorkspaceDetailView.as_view()),
    path("workspaces/<int:pk>/members", views.WorkspaceMembersView.as_view()),
    path("workspaces/<int:pk>/members/<int:user_id>", views.WorkspaceMembersView.as_view()),
]
