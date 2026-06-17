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
