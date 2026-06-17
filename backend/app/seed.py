"""Seed the pois table from the geocoder's JSON output on first run."""

from __future__ import annotations

import json
import logging
import sqlite3

from . import crud
from .config import settings

log = logging.getLogger(__name__)

_POI_FIELDS = (
    "Naam",
    "Snelweg",
    "Richting",
    "Type",
    "Latitude",
    "Longitude",
    "OSM_Class",
    "OSM_Type_Tag",
)


def seed_pois(conn: sqlite3.Connection) -> int:
    """Load POIs from the seed file if the table is empty. Returns rows added."""
    existing = conn.execute("SELECT COUNT(*) FROM pois").fetchone()[0]
    if existing:
        log.info("pois table already has %d rows; skipping seed", existing)
        return 0

    path = settings.seed_file
    if not path.exists():
        log.warning("Seed file %s not found; pois table left empty", path)
        return 0

    records = json.loads(path.read_text(encoding="utf-8"))
    added = 0
    for record in records:
        if record.get("Latitude") is None or record.get("Longitude") is None:
            # Skip POIs the geocoder could not resolve.
            continue
        crud.insert_row(conn, "pois", {field: record.get(field) for field in _POI_FIELDS})
        added += 1

    log.info("Seeded %d POIs from %s", added, path)
    return added
