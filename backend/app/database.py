"""SQLite connection handling and schema initialisation.

The data layer is intentionally thin and isolated here so that swapping
SQLite for PostgreSQL later only touches this module (plus crud.py),
not the routers.
"""

from __future__ import annotations

import logging
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager

from .config import settings

log = logging.getLogger(__name__)

# Schema. Keep column names aligned with the geocoder output and the
# frontend (Naam, Latitude, ...) to avoid a translation layer.
SCHEMA: tuple[str, ...] = (
    """
    CREATE TABLE IF NOT EXISTS pois (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        Naam          TEXT NOT NULL,
        Snelweg       TEXT,
        Richting      TEXT,
        Type          TEXT,
        Latitude      REAL NOT NULL,
        Longitude     REAL NOT NULL,
        OSM_Class     TEXT,
        OSM_Type_Tag  TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS vehicles (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        licensePlate TEXT NOT NULL,
        brand        TEXT NOT NULL,
        model        TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS drivers (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        firstName      TEXT NOT NULL,
        lastName       TEXT NOT NULL,
        employeeNumber TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS trips (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        tripName            TEXT NOT NULL,
        startLocation       TEXT NOT NULL,
        endLocation         TEXT NOT NULL,
        departureTime       TEXT,
        status              TEXT NOT NULL DEFAULT 'Gepland',
        expectedTimeMinutes INTEGER,
        distanceKm          REAL,
        vehicleId           INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
        driverId            INTEGER REFERENCES drivers(id) ON DELETE SET NULL
    )
    """,
)


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(settings.database_file)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def get_connection() -> Iterator[sqlite3.Connection]:
    """Context manager for use outside the request cycle (seeding, scripts)."""
    conn = _connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def get_conn() -> Iterator[sqlite3.Connection]:
    """FastAPI dependency: one connection per request, committed on success."""
    conn = _connect()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    """Create the database file and tables if they do not exist yet."""
    settings.database_file.parent.mkdir(parents=True, exist_ok=True)
    with get_connection() as conn:
        for statement in SCHEMA:
            conn.execute(statement)
    log.info("Database ready at %s", settings.database_file)
