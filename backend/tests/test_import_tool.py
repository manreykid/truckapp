"""Unit tests for tools/import_firebase.py (loaded by file path)."""

from __future__ import annotations

import importlib.util
from pathlib import Path

_TOOL = Path(__file__).resolve().parents[2] / "tools" / "import_firebase.py"
_spec = importlib.util.spec_from_file_location("import_firebase", _TOOL)
tool = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(tool)


def test_float_coordinates_pass_through_unchanged():
    assert tool.fix_coordinate(52.3205346, "lat") == 52.3205346
    assert tool.fix_coordinate(5.0792278, "lon") == 5.0792278
    assert tool.fix_coordinate("52.32", "lat") == 52.32


def test_legacy_integer_coordinates_are_rescaled():
    # The old frontend encoding: digits without a decimal separator.
    assert tool.fix_coordinate(523205346, "lat") == 52.3205346
    assert tool.fix_coordinate(50792278, "lon") == 5.0792278
    assert tool.fix_coordinate("522943360", "lat") == 52.294336


def test_unresolvable_coordinates_return_none():
    assert tool.fix_coordinate("abc", "lat") is None
    assert tool.fix_coordinate(None, "lat") is None
    assert tool.fix_coordinate(999999, "lat") is None  # never lands in NL band
    assert tool.fix_coordinate(48.85, "lat") is None  # Paris: outside NL box


def test_normalize_record_maps_field_variants():
    record = tool.normalize_record(
        {"name": "Hackelaar", "highway": "A1", "lat": 52.3221142, "lng": 5.0827356}
    )
    assert record == {
        "Naam": "Hackelaar",
        "Snelweg": "A1",
        "Richting": "",
        "Type": "poi_snelweg",
        "Latitude": 52.3221142,
        "Longitude": 5.0827356,
        "OSM_Class": "",
        "OSM_Type_Tag": "",
    }


def test_normalize_record_reads_firestore_geopoint():
    record = tool.normalize_record(
        {"Naam": "Bastion", "location": {"_latitude": 52.2953673, "_longitude": 5.177806}}
    )
    assert record["Latitude"] == 52.2953673
    assert record["Longitude"] == 5.177806


def test_normalize_record_rejects_incomplete_documents():
    assert tool.normalize_record({"Naam": "X"}) is None  # no coordinates
    assert tool.normalize_record({"Latitude": 52.0, "Longitude": 5.0}) is None  # no name


def test_convert_dedupes_and_reports_skips():
    docs = [
        {"Naam": "Ronduit", "Snelweg": "A1", "Latitude": 522943360, "Longitude": 51769962},
        {"Naam": "Ronduit", "Snelweg": "A1", "Latitude": 52.294336, "Longitude": 5.1769962},
        {"Naam": "Kapot", "Latitude": "n/a", "Longitude": None},
    ]
    records, skipped = tool.convert(docs)
    assert len(records) == 1  # integer and float encodings dedupe to one POI
    assert records[0]["Latitude"] == 52.294336
    assert skipped == ["Kapot"]
