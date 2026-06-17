"""Geocode Dutch motorway rest areas / fuel / service stops via Nominatim.

This is the data-preparation tool ("the factory"): it turns a list of POI
names into enriched records with coordinates and OSM tags, and writes them to
``data/a1_poi.json`` for the backend to seed from.

Strategy (two stages), to avoid matching motorway *junctions* instead of the
actual facility:

  1. Reference point - a rough coordinate from "{name}, {road}, Nederland".
  2. Targeted search - within a small viewbox around that point, look for
     objects tagged highway=services / highway=rest_area / amenity=fuel.

Coordinates are written as plain decimal-degree floats (e.g. 52.3205346) - the
format the backend and frontend expect. Respect the Nominatim usage policy:
one request per second and a descriptive user_agent.
"""

from __future__ import annotations

import argparse
import json
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path

from geopy.exc import GeocoderServiceError, GeocoderTimedOut
from geopy.geocoders import Nominatim

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger("geocoder")

# OSM tags that count as a valid rest stop / fuel / service area.
VALID_OSM_TAGS: tuple[tuple[str, str], ...] = (
    ("amenity", "fuel"),
    ("highway", "services"),
    ("highway", "rest_area"),
)

DEFAULT_OUTPUT = Path(__file__).resolve().parents[1] / "data" / "a1_poi.json"

# Default input: A1 rest stops (replace/extend with your full dataset).
A1_POIS: list[dict[str, str]] = [
    {"Naam": name, "Snelweg": "A1"}
    for name in (
        "Honswijck", "Hackelaar", "Ronduit", "Bastion", "De Slaag", "Neerduist",
        "Aanschoten", "De Middelaar", "Uilengoor", "Palmpol", "Tolnegen",
        "De Strubben", "Lucasgat", "De Hucht",
    )
]


@dataclass
class GeocodeResult:
    poi: dict[str, str]
    latitude: float | None = None
    longitude: float | None = None
    osm_class: str | None = None
    osm_type: str | None = None
    valid_match: bool = False

    def to_record(self) -> dict:
        return {
            "Naam": self.poi.get("Naam"),
            "Snelweg": self.poi.get("Snelweg"),
            "Richting": self.poi.get("Richting", ""),
            "Type": "poi_snelweg",
            "Latitude": self.latitude,
            "Longitude": self.longitude,
            "OSM_Class": self.osm_class,
            "OSM_Type_Tag": self.osm_type,
            "Match_Valide": self.valid_match,
        }


@dataclass
class TruckGeocoder:
    user_agent: str = "VrachtwagenParkeerApp/1.0 (contact: you@example.com)"
    country_codes: str = "nl"
    pause_seconds: float = 1.0
    viewbox_delta: float = 0.015  # ~1.5 km half-width around the reference point
    _geolocator: Nominatim = field(init=False)

    def __post_init__(self) -> None:
        self._geolocator = Nominatim(user_agent=self.user_agent)

    def _geocode(self, query: str, **kwargs) -> object | None:
        """Single Nominatim call with retries and polite rate-limiting."""
        for attempt in range(3):
            try:
                location = self._geolocator.geocode(
                    query,
                    country_codes=self.country_codes,
                    addressdetails=True,
                    extratags=True,
                    timeout=10,
                    **kwargs,
                )
                time.sleep(self.pause_seconds)
                return location
            except (GeocoderTimedOut, GeocoderServiceError) as exc:
                wait = self.pause_seconds * (attempt + 2)
                log.warning("Query %r faalde (%s); opnieuw over %.0fs", query, exc, wait)
                time.sleep(wait)
        return None

    def _reference_point(self, poi: dict[str, str]) -> tuple[float, float] | None:
        for query in (
            f"{poi['Naam']}, {poi.get('Snelweg', '')}, Nederland",
            f"{poi['Naam']}, Nederland",
        ):
            location = self._geocode(query)
            if location:
                return location.latitude, location.longitude
        return None

    def _search_in_viewbox(
        self, poi: dict[str, str], ref: tuple[float, float]
    ) -> GeocodeResult | None:
        lat, lon = ref
        d = self.viewbox_delta
        viewbox = ((lat + d, lon - d), (lat - d, lon + d))

        for key, value in VALID_OSM_TAGS:
            for query in (f"{poi['Naam']} [{key}={value}]", f"[{key}={value}]"):
                location = self._geocode(query, viewbox=viewbox, bounded=True)
                if not location:
                    continue
                raw = location.raw
                if raw.get(key) == value or raw.get("type") == value:
                    return GeocodeResult(
                        poi=poi,
                        latitude=location.latitude,
                        longitude=location.longitude,
                        osm_class=raw.get("class"),
                        osm_type=raw.get("type"),
                        valid_match=True,
                    )
        return None

    def process(self, poi: dict[str, str]) -> GeocodeResult:
        log.info("Verwerken: %s (%s)", poi["Naam"], poi.get("Snelweg", "?"))
        ref = self._reference_point(poi)
        if ref is None:
            log.warning("  Geen referentiepunt voor %s", poi["Naam"])
            return GeocodeResult(poi=poi)

        match = self._search_in_viewbox(poi, ref)
        if match:
            log.info("  Match: %.6f, %.6f (%s)", match.latitude, match.longitude, match.osm_type)
            return match

        # Fallback: keep the rough reference point, flagged as unvalidated.
        log.info("  Geen exacte voorziening gevonden; referentiepunt gebruikt")
        return GeocodeResult(poi=poi, latitude=ref[0], longitude=ref[1], valid_match=False)


def run(pois: list[dict[str, str]], output: Path) -> None:
    geocoder = TruckGeocoder()
    records = [geocoder.process(poi).to_record() for poi in pois]

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")

    found = sum(1 for r in records if r["Latitude"] is not None)
    valid = sum(1 for r in records if r["Match_Valide"])
    log.info("Klaar: %d/%d met coordinaten, %d gevalideerd -> %s", found, len(records), valid, output)


def main() -> None:
    parser = argparse.ArgumentParser(description="Geocode motorway rest stops.")
    parser.add_argument(
        "--input",
        type=Path,
        help="JSON file with a list of {Naam, Snelweg} objects (defaults to built-in A1 list).",
    )
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="Output JSON path.")
    args = parser.parse_args()

    pois = json.loads(args.input.read_text(encoding="utf-8")) if args.input else A1_POIS
    run(pois, args.output)


if __name__ == "__main__":
    main()
