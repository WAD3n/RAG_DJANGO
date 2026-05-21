#!/usr/bin/env python
"""Django management entry point."""

import os
import sys
from pathlib import Path

# Add the backend/ directory to sys.path so that 'core', 'api', 'project'
# are importable as top-level packages.
sys.path.insert(0, str(Path(__file__).parent))


def main() -> None:
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "project.settings")
    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:
        raise ImportError(
            "Couldn't import Django. Activate the venv:\n"
            "  .\\venv\\Scripts\\Activate.ps1"
        ) from exc
    execute_from_command_line(sys.argv)


if __name__ == "__main__":
    main()
