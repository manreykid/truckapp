"""Tiny generic CRUD helpers over a sqlite3 connection.

Security note: table and column names passed here come exclusively from
trusted internal constants and Pydantic model fields, never from request
bodies/paths directly, so the f-string interpolation below is safe.
All *values* are bound as parameters.
"""

from __future__ import annotations

import sqlite3
from typing import Any


def list_rows(
    conn: sqlite3.Connection, table: str, order_by: str | None = None
) -> list[dict[str, Any]]:
    query = f"SELECT * FROM {table}"
    if order_by:
        query += f" ORDER BY {order_by}"
    return [dict(row) for row in conn.execute(query).fetchall()]


def get_row(
    conn: sqlite3.Connection, table: str, row_id: int
) -> dict[str, Any] | None:
    row = conn.execute(
        f"SELECT * FROM {table} WHERE id = ?", (row_id,)
    ).fetchone()
    return dict(row) if row else None


def insert_row(conn: sqlite3.Connection, table: str, data: dict[str, Any]) -> int:
    columns = ", ".join(data.keys())
    placeholders = ", ".join("?" for _ in data)
    cursor = conn.execute(
        f"INSERT INTO {table} ({columns}) VALUES ({placeholders})",
        tuple(data.values()),
    )
    return int(cursor.lastrowid)


def update_row(
    conn: sqlite3.Connection, table: str, row_id: int, data: dict[str, Any]
) -> bool:
    if not data:
        return get_row(conn, table, row_id) is not None
    assignments = ", ".join(f"{key} = ?" for key in data)
    cursor = conn.execute(
        f"UPDATE {table} SET {assignments} WHERE id = ?",
        (*data.values(), row_id),
    )
    return cursor.rowcount > 0


def delete_row(conn: sqlite3.Connection, table: str, row_id: int) -> bool:
    cursor = conn.execute(f"DELETE FROM {table} WHERE id = ?", (row_id,))
    return cursor.rowcount > 0


# --- Domain-specific queries -------------------------------------------------

_TRIPS_WITH_NAMES = """
    SELECT t.*,
           v.licensePlate AS vehiclePlate,
           d.firstName || ' ' || d.lastName AS driverName
    FROM trips t
    LEFT JOIN vehicles v ON v.id = t.vehicleId
    LEFT JOIN drivers  d ON d.id = t.driverId
"""


def list_trips_with_names(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    """Trips enriched with vehicle plate and driver name for display."""
    rows = conn.execute(_TRIPS_WITH_NAMES + " ORDER BY t.id DESC").fetchall()
    return [dict(row) for row in rows]


def get_trip_with_names(
    conn: sqlite3.Connection, trip_id: int
) -> dict[str, Any] | None:
    row = conn.execute(_TRIPS_WITH_NAMES + " WHERE t.id = ?", (trip_id,)).fetchone()
    return dict(row) if row else None


def collect_stats(conn: sqlite3.Connection) -> dict[str, Any]:
    """Counters for the dashboard tiles."""
    vehicles = conn.execute("SELECT COUNT(*) FROM vehicles").fetchone()[0]
    drivers = conn.execute("SELECT COUNT(*) FROM drivers").fetchone()[0]
    by_status = {
        row[0]: row[1]
        for row in conn.execute("SELECT status, COUNT(*) FROM trips GROUP BY status")
    }
    return {
        "vehicles": vehicles,
        "drivers": drivers,
        "tripsTotal": sum(by_status.values()),
        "tripsByStatus": by_status,
    }
