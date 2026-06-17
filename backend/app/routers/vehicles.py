"""Fleet (vehicles) CRUD."""

from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, HTTPException, status

from .. import crud
from ..database import get_conn
from ..models import Vehicle, VehicleCreate

router = APIRouter(prefix="/api/vehicles", tags=["vehicles"])
_TABLE = "vehicles"


@router.get("", response_model=list[Vehicle])
def list_vehicles(conn: sqlite3.Connection = Depends(get_conn)) -> list[dict]:
    return crud.list_rows(conn, _TABLE, order_by="id DESC")


@router.post("", response_model=Vehicle, status_code=status.HTTP_201_CREATED)
def create_vehicle(
    payload: VehicleCreate, conn: sqlite3.Connection = Depends(get_conn)
) -> dict:
    new_id = crud.insert_row(conn, _TABLE, payload.model_dump())
    return crud.get_row(conn, _TABLE, new_id)


@router.put("/{vehicle_id}", response_model=Vehicle)
def update_vehicle(
    vehicle_id: int,
    payload: VehicleCreate,
    conn: sqlite3.Connection = Depends(get_conn),
) -> dict:
    if not crud.update_row(conn, _TABLE, vehicle_id, payload.model_dump()):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vehicle not found")
    return crud.get_row(conn, _TABLE, vehicle_id)


@router.delete("/{vehicle_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_vehicle(
    vehicle_id: int, conn: sqlite3.Connection = Depends(get_conn)
) -> None:
    if not crud.delete_row(conn, _TABLE, vehicle_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vehicle not found")
