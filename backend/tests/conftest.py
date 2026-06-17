"""Test fixtures.

The environment is configured to point at a throwaway database and a tiny
seed file *before* the app (and thus its Settings) is imported.
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

import pytest

_TMP = Path(tempfile.mkdtemp())
os.environ["DATABASE_PATH"] = str(_TMP / "test.db")

_seed = _TMP / "seed.json"
_seed.write_text(
    json.dumps(
        [
            {
                "Naam": "Testplaats",
                "Snelweg": "A1",
                "Richting": "Rechts",
                "Type": "poi_snelweg",
                "Latitude": 52.32,
                "Longitude": 5.07,
                "OSM_Class": "highway",
                "OSM_Type_Tag": "services",
            }
        ]
    ),
    encoding="utf-8",
)
os.environ["DATA_SEED_FILE"] = str(_seed)

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    # Entering the context manager triggers the lifespan (init_db + seed).
    with TestClient(app) as test_client:
        yield test_client
