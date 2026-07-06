"""Trips CRUD, including partial status updates.

List/detail responses are enriched with the assigned vehicle plate and
driver name (LEFT JOIN in the data layer), so the frontend does not need
to stitch collections together client-side.
"""

from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, HTTPException, status

from .. import crud
from ..database import get_conn
from ..models import Trip, TripCreate, TripUpdate

router = APIRouter(prefix="/api/trips", tags=["trips"])
_TABLE = "trips"


@router.get("", response_model=list[Trip])
def list_trips(conn: sqlite3.Connection = Depends(get_conn)) -> list[dict]:
    return crud.list_trips_with_names(conn)


@router.post("", response_model=Trip, status_code=status.HTTP_201_CREATED)
def create_trip(
    payload: TripCreate, conn: sqlite3.Connection = Depends(get_conn)
) -> dict:
    new_id = crud.insert_row(conn, _TABLE, payload.model_dump())
    return crud.get_trip_with_names(conn, new_id)


@router.patch("/{trip_id}", response_model=Trip)
def update_trip(
    trip_id: int,
    payload: TripUpdate,
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict:
    changes = payload.model_dump(exclude_unset=True)
    if not crud.update_row(conn, _TABLE, trip_id, changes):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Trip not found")
    return crud.get_trip_with_names(conn, trip_id)


@router.delete("/{trip_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_trip(
    trip_id: int, conn: sqlite3.Connection = Depends(get_conn)
) -> None:
    if not crud.delete_row(conn, _TABLE, trip_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Trip not found")
