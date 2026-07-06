"""Tests for the v2 API additions: joined trips, status enum, stats."""

from __future__ import annotations


def _create_fleet(client):
    vehicle = client.post(
        "/api/vehicles",
        json={"licensePlate": "77-TST-7", "brand": "DAF", "model": "XF"},
    ).json()
    driver = client.post(
        "/api/drivers",
        json={"firstName": "Piet", "lastName": "Post", "employeeNumber": "42"},
    ).json()
    return vehicle, driver


def test_trip_list_includes_vehicle_and_driver_names(client):
    vehicle, driver = _create_fleet(client)
    trip = client.post(
        "/api/trips",
        json={
            "tripName": "Testrit met namen",
            "startLocation": "Utrecht",
            "endLocation": "Hamburg",
            "vehicleId": vehicle["id"],
            "driverId": driver["id"],
        },
    ).json()

    # Both the create response and the list are enriched via the JOIN.
    assert trip["vehiclePlate"] == "77-TST-7"
    assert trip["driverName"] == "Piet Post"

    listed = next(t for t in client.get("/api/trips").json() if t["id"] == trip["id"])
    assert listed["vehiclePlate"] == "77-TST-7"
    assert listed["driverName"] == "Piet Post"

    # Unassigned trips simply have nulls, not errors.
    bare = client.post(
        "/api/trips",
        json={"tripName": "Los", "startLocation": "A", "endLocation": "B"},
    ).json()
    assert bare["vehiclePlate"] is None
    assert bare["driverName"] is None

    for trip_id in (trip["id"], bare["id"]):
        client.delete(f"/api/trips/{trip_id}")
    client.delete(f"/api/vehicles/{vehicle['id']}")
    client.delete(f"/api/drivers/{driver['id']}")


def test_trip_status_enum_is_enforced(client):
    bad_create = client.post(
        "/api/trips",
        json={
            "tripName": "X",
            "startLocation": "A",
            "endLocation": "B",
            "status": "Zoekgeraakt",
        },
    )
    assert bad_create.status_code == 422

    trip = client.post(
        "/api/trips",
        json={"tripName": "X", "startLocation": "A", "endLocation": "B"},
    ).json()

    bad_patch = client.patch(f"/api/trips/{trip['id']}", json={"status": "Kwijt"})
    assert bad_patch.status_code == 422

    for status_value in ("Onderweg", "Afgerond", "Geannuleerd"):
        ok = client.patch(f"/api/trips/{trip['id']}", json={"status": status_value})
        assert ok.status_code == 200
        assert ok.json()["status"] == status_value

    client.delete(f"/api/trips/{trip['id']}")


def test_stats_counts_move_with_data(client):
    before = client.get("/api/stats").json()
    assert set(before) == {"vehicles", "drivers", "tripsTotal", "tripsByStatus"}

    vehicle, driver = _create_fleet(client)
    trip = client.post(
        "/api/trips",
        json={"tripName": "Statrit", "startLocation": "A", "endLocation": "B"},
    ).json()

    after = client.get("/api/stats").json()
    assert after["vehicles"] == before["vehicles"] + 1
    assert after["drivers"] == before["drivers"] + 1
    assert after["tripsTotal"] == before["tripsTotal"] + 1
    gepland_before = before["tripsByStatus"].get("Gepland", 0)
    assert after["tripsByStatus"]["Gepland"] == gepland_before + 1

    client.delete(f"/api/trips/{trip['id']}")
    client.delete(f"/api/vehicles/{vehicle['id']}")
    client.delete(f"/api/drivers/{driver['id']}")
