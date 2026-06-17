"""Drivers CRUD."""

from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, HTTPException, status

from .. import crud
from ..database import get_conn
from ..models import Driver, DriverCreate

router = APIRouter(prefix="/api/drivers", tags=["drivers"])
_TABLE = "drivers"


@router.get("", response_model=list[Driver])
def list_drivers(conn: sqlite3.Connection = Depends(get_conn)) -> list[dict]:
    return crud.list_rows(conn, _TABLE, order_by="id DESC")


@router.post("", response_model=Driver, status_code=status.HTTP_201_CREATED)
def create_driver(
    payload: DriverCreate, conn: sqlite3.Connection = Depends(get_conn)
) -> dict:
    new_id = crud.insert_row(conn, _TABLE, payload.model_dump())
    return crud.get_row(conn, _TABLE, new_id)


@router.put("/{driver_id}", response_model=Driver)
def update_driver(
    driver_id: int,
    payload: DriverCreate,
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict:
    if not crud.update_row(conn, _TABLE, driver_id, payload.model_dump()):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Driver not found")
    return crud.get_row(conn, _TABLE, driver_id)


@router.delete("/{driver_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_driver(
    driver_id: int, conn: sqlite3.Connection = Depends(get_conn)
) -> None:
    if not crud.delete_row(conn, _TABLE, driver_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Driver not found")
