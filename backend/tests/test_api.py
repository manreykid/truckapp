"""API smoke + CRUD tests."""

from __future__ import annotations


def test_health(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_pois_seeded_with_real_float_coordinates(client):
    resp = client.get("/api/pois")
    assert resp.status_code == 200
    pois = resp.json()
    assert len(pois) >= 1

    poi = next(p for p in pois if p["Naam"] == "Testplaats")
    # Coordinates must survive as proper floats (regression guard for the
    # old "divide by a power of ten" frontend bug).
    assert poi["Latitude"] == 52.32
    assert poi["Longitude"] == 5.07
    assert 49 < poi["Latitude"] < 54
    assert 3 < poi["Longitude"] < 8


def test_vehicle_crud(client):
    created = client.post(
        "/api/vehicles",
        json={"licensePlate": "12-ABC-3", "brand": "Scania", "model": "R450"},
    )
    assert created.status_code == 201
    vehicle = created.json()
    assert vehicle["id"] > 0
    assert vehicle["licensePlate"] == "12-ABC-3"

    listed = client.get("/api/vehicles")
    assert any(v["id"] == vehicle["id"] for v in listed.json())

    deleted = client.delete(f"/api/vehicles/{vehicle['id']}")
    assert deleted.status_code == 204

    assert client.delete(f"/api/vehicles/{vehicle['id']}").status_code == 404


def test_vehicle_validation_rejects_empty(client):
    resp = client.post("/api/vehicles", json={"licensePlate": "", "brand": ""})
    assert resp.status_code == 422


def test_driver_crud(client):
    created = client.post(
        "/api/drivers",
        json={"firstName": "Jan", "lastName": "Jansen", "employeeNumber": "007"},
    )
    assert created.status_code == 201
    driver_id = created.json()["id"]

    assert any(d["id"] == driver_id for d in client.get("/api/drivers").json())
    assert client.delete(f"/api/drivers/{driver_id}").status_code == 204


def test_trip_create_and_status_patch(client):
    created = client.post(
        "/api/trips",
        json={
            "tripName": "Van Amsterdam naar Berlijn",
            "startLocation": "Amsterdam",
            "endLocation": "Berlijn",
            "departureTime": "2026-06-17T08:00",
            "expectedTimeMinutes": 380,
            "distanceKm": 575.4,
        },
    )
    assert created.status_code == 201
    trip = created.json()
    assert trip["status"] == "Gepland"

    patched = client.patch(f"/api/trips/{trip['id']}", json={"status": "Onderweg"})
    assert patched.status_code == 200
    assert patched.json()["status"] == "Onderweg"
    # Untouched fields stay intact.
    assert patched.json()["distanceKm"] == 575.4

    assert client.delete(f"/api/trips/{trip['id']}").status_code == 204
