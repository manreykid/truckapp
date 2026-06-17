"""Points of interest (rest areas, fuel, service areas). Read-only."""

from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends

from .. import crud
from ..database import get_conn
from ..models import POI

router = APIRouter(prefix="/api/pois", tags=["pois"])


@router.get("", response_model=list[POI])
def list_pois(conn: sqlite3.Connection = Depends(get_conn)) -> list[dict]:
    return crud.list_rows(conn, "pois", order_by="Naam")
