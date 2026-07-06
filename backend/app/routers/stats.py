"""Dashboard statistics (counters for the overview tiles)."""

from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends

from .. import crud
from ..database import get_conn
from ..models import Stats

router = APIRouter(prefix="/api/stats", tags=["stats"])


@router.get("", response_model=Stats)
def get_stats(conn: sqlite3.Connection = Depends(get_conn)) -> dict:
    return crud.collect_stats(conn)
