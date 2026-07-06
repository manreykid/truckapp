"""Pydantic request/response schemas.

Field names intentionally mirror the existing frontend and geocoder output
(Naam, Latitude, licensePlate, ...) so no field-name translation is needed.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

# Trip lifecycle. Validated at the API boundary; stored as TEXT in SQLite.
TripStatus = Literal["Gepland", "Onderweg", "Afgerond", "Geannuleerd"]


# --- POIs (read-only via the API; populated by the geocoder/seed) ---
class POI(BaseModel):
    id: int
    Naam: str
    Snelweg: str | None = None
    Richting: str | None = None
    Type: str | None = None
    Latitude: float
    Longitude: float
    OSM_Class: str | None = None
    OSM_Type_Tag: str | None = None


# --- Vehicles ---
class VehicleCreate(BaseModel):
    licensePlate: str = Field(min_length=1)
    brand: str = Field(min_length=1)
    model: str | None = None


class Vehicle(VehicleCreate):
    id: int


# --- Drivers ---
class DriverCreate(BaseModel):
    firstName: str = Field(min_length=1)
    lastName: str = Field(min_length=1)
    employeeNumber: str | None = None


class Driver(DriverCreate):
    id: int


# --- Trips ---
class TripCreate(BaseModel):
    tripName: str = Field(min_length=1)
    startLocation: str = Field(min_length=1)
    endLocation: str = Field(min_length=1)
    departureTime: str | None = None
    status: TripStatus = "Gepland"
    expectedTimeMinutes: int | None = None
    distanceKm: float | None = None
    vehicleId: int | None = None
    driverId: int | None = None


class TripUpdate(BaseModel):
    """Partial update; only provided fields are changed."""

    tripName: str | None = None
    startLocation: str | None = None
    endLocation: str | None = None
    departureTime: str | None = None
    status: TripStatus | None = None
    expectedTimeMinutes: int | None = None
    distanceKm: float | None = None
    vehicleId: int | None = None
    driverId: int | None = None


class Trip(TripCreate):
    id: int
    # Denormalised for display, filled by a LEFT JOIN in the data layer.
    vehiclePlate: str | None = None
    driverName: str | None = None


# --- Dashboard statistics ---
class Stats(BaseModel):
    vehicles: int
    drivers: int
    tripsTotal: int
    tripsByStatus: dict[str, int]
