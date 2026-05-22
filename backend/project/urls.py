from django.urls import include, path

urlpatterns = [
    path("", include("django_prometheus.urls")),
    path("api/", include("api.urls")),
]
