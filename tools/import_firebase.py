"""Convert a Firestore export into the POI seed format used by the backend.

Input: a JSON file produced by an export script (list of documents, or a
dict of id -> document). Output: the seed JSON the backend loads on first
start (data/a1_poi.json), and optionally rows inserted straight into the
SQLite database.

Handles the quirks of the legacy Firebase data:

* Field-name variants (Naam/naam/name, Latitude/latitude/lat, ...).
* Firestore GeoPoint values exported as {"latitude": ..., "longitude": ...}
  (or {"_latitude": ...} / {"lat": ..., "lng": ...}) under a location field.
* Legacy integer-encoded coordinates (e.g. 523205346 meaning 52.3205346):
  detected and rescaled by repeated division by 10 until the value falls
  within the Netherlands' bounding box. Records whose coordinates cannot be
  resolved are skipped and reported.

Usage:
    python3 tools/import_firebase.py pois_export.json
    python3 tools/import_firebase.py pois_export.json --output data/a1_poi.json
    python3 tools/import_firebase.py pois_export.json --db data/truckapp.db --replace

Standard library only - no Firebase dependency needed (the export already
happened on your machine).
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = REPO_ROOT / "data" / "a1_poi.json"

# Bounding box of the Netherlands (with a little margin). Used both to
# validate coordinates and to detect the legacy integer encoding.
NL_LAT = (50.5, 53.8)
NL_LON = (3.0, 7.5)

POI_COLUMNS = (
    "Naam",
    "Snelweg",
    "Richting",
    "Type",
    "Latitude",
    "Longitude",
    "OSM_Class",
    "OSM_Type_Tag",
)


def fix_coordinate(value: object, kind: str) -> float | None:
    """Return a decimal-degree float within NL bounds, or None.

    Accepts proper floats as-is and rescales legacy integer encodings
    (523205346 -> 52.3205346, 50792278 -> 5.0792278) by dividing by 10
    until the value lands inside the NL bounding box for its axis.
    """
    lo, hi = NL_LAT if kind == "lat" else NL_LON
    try:
        v = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None

    if lo <= v <= hi:
        return v

    v = abs(v)
    for _ in range(12):
        v /= 10
        if lo <= v <= hi:
            return round(v, 7)
    return None


def _first(doc: dict, *keys: str) -> object | None:
    for key in keys:
        if key in doc and doc[key] not in (None, ""):
            return doc[key]
    return None


def _extract_raw_coords(doc: dict) -> tuple[object, object]:
    """Find raw lat/lon in the document, including nested GeoPoint shapes."""
    lat = _first(doc, "Latitude", "latitude", "lat")
    lon = _first(doc, "Longitude", "longitude", "lon", "lng")
    if lat is not None and lon is not None:
        return lat, lon

    for key in ("location", "position", "coords", "geopoint", "GeoPoint"):
        nested = doc.get(key)
        if isinstance(nested, dict):
            nested_lat = _first(nested, "latitude", "_latitude", "lat")
            nested_lon = _first(nested, "longitude", "_longitude", "lon", "lng")
            if nested_lat is not None and nested_lon is not None:
                return nested_lat, nested_lon
    return None, None


def normalize_record(doc: dict) -> dict | None:
    """Map one Firestore document to the seed format; None if unusable."""
    name = _first(doc, "Naam", "naam", "name", "Name")
    if not name or not str(name).strip():
        return None

    raw_lat, raw_lon = _extract_raw_coords(doc)
    lat = fix_coordinate(raw_lat, "lat")
    lon = fix_coordinate(raw_lon, "lon")
    if lat is None or lon is None:
        return None

    return {
        "Naam": str(name).strip(),
        "Snelweg": _first(doc, "Snelweg", "snelweg", "highway", "Weg") or "",
        "Richting": _first(doc, "Richting", "richting", "direction") or "",
        "Type": _first(doc, "Type", "type") or "poi_snelweg",
        "Latitude": lat,
        "Longitude": lon,
        "OSM_Class": _first(doc, "OSM_Class", "osm_class") or "",
        "OSM_Type_Tag": _first(doc, "OSM_Type_Tag", "OSM_Type", "osm_type") or "",
    }


def load_documents(path: Path) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict):
        # Export keyed by document id.
        return [doc for doc in data.values() if isinstance(doc, dict)]
    if isinstance(data, list):
        return [doc for doc in data if isinstance(doc, dict)]
    raise SystemExit(f"Onverwacht JSON-formaat in {path}: verwacht list of dict.")


def convert(documents: list[dict]) -> tuple[list[dict], list[str]]:
    """Normalize + dedupe. Returns (records, skipped_names)."""
    records: list[dict] = []
    skipped: list[str] = []
    seen: set[tuple] = set()

    for doc in documents:
        record = normalize_record(doc)
        if record is None:
            label = str(_first(doc, "Naam", "naam", "name", "Name", "_id") or "<zonder naam>")
            skipped.append(label)
            continue
        key = (
            record["Naam"].lower(),
            record["Snelweg"],
            record["Richting"],
            round(record["Latitude"], 5),
            round(record["Longitude"], 5),
        )
        if key in seen:
            continue
        seen.add(key)
        records.append(record)

    return records, skipped


def write_db(records: list[dict], db_path: Path, replace: bool) -> int:
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS pois (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                Naam          TEXT NOT NULL,
                Snelweg       TEXT,
                Richting      TEXT,
                Type          TEXT,
                Latitude      REAL NOT NULL,
                Longitude     REAL NOT NULL,
                OSM_Class     TEXT,
                OSM_Type_Tag  TEXT
            )
            """
        )
        if replace:
            conn.execute("DELETE FROM pois")
        placeholders = ", ".join("?" for _ in POI_COLUMNS)
        conn.executemany(
            f"INSERT INTO pois ({', '.join(POI_COLUMNS)}) VALUES ({placeholders})",
            [tuple(record[col] for col in POI_COLUMNS) for record in records],
        )
        conn.commit()
        return conn.execute("SELECT COUNT(*) FROM pois").fetchone()[0]
    finally:
        conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Firestore-export -> POI-seed converter.")
    parser.add_argument("input", type=Path, help="JSON-export van Firestore.")
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Seed-bestand om te schrijven (default: {DEFAULT_OUTPUT}).",
    )
    parser.add_argument(
        "--db",
        type=Path,
        help="Optioneel: schrijf de POIs ook direct naar deze SQLite-database.",
    )
    parser.add_argument(
        "--replace",
        action="store_true",
        help="Leeg de pois-tabel voordat er wordt ingevoegd (alleen met --db).",
    )
    args = parser.parse_args()

    documents = load_documents(args.input)
    records, skipped = convert(documents)

    print(f"Gelezen: {len(documents)} documenten")
    print(f"Bruikbaar: {len(records)} POIs (na dedupe)")
    if skipped:
        preview = ", ".join(skipped[:10]) + (" ..." if len(skipped) > 10 else "")
        print(f"Overgeslagen (geen naam/coordinaten): {len(skipped)} -> {preview}")

    if not records:
        sys.exit("Geen bruikbare records gevonden; er is niets geschreven.")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"Seed geschreven naar {args.output}")

    if args.db:
        total = write_db(records, args.db, args.replace)
        print(f"Database {args.db}: pois-tabel bevat nu {total} rijen")


if __name__ == "__main__":
    main()
