"""Minimal URL configuration for the test suite (no django_prometheus)."""
from django.urls import include, path

urlpatterns = [
    path("api/", include("api.urls")),
]
