"""Test settings — strips unavailable optional apps and heavy service init."""
from project.settings import *  # noqa: F401, F403

INSTALLED_APPS = [app for app in INSTALLED_APPS if app != "django_prometheus"]  # noqa: F405

MIDDLEWARE = [m for m in MIDDLEWARE if "prometheus" not in m.lower()]  # noqa: F405

# Use a minimal URL conf that doesn't reference django_prometheus.
ROOT_URLCONF = "project.urls_test"

# Signal to AppConfig.ready() to skip heavyweight service initialisation.
TESTING = True
