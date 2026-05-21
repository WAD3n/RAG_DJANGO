import logging
import os
import sys

from django.apps import AppConfig

logger = logging.getLogger(__name__)


class ApiConfig(AppConfig):
    name = "api"
    verbose_name = "RAG API"

    def ready(self) -> None:
        # Django dev-server spawns a subprocess (RUN_MAIN=true) for autoreload.
        # Skip heavy model loading in the parent process to avoid double-init.
        is_dev_parent = "runserver" in sys.argv and os.environ.get("RUN_MAIN") != "true"
        if is_dev_parent:
            logger.debug("Dev-server parent process — skipping model init")
            return
        logger.info("App ready — starting model initialisation")
        from . import services
        services.init_all()
