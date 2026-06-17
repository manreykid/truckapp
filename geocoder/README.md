# Geocoder

Data-preparation tool. Turns a list of POI names into enriched records
(coordinates + OSM tags) and writes them to `../data/a1_poi.json`, which the
backend seeds into its database on first start.

This is **not** part of the running app — you run it occasionally, offline,
when you have new POI names to resolve.

## Usage

```bash
cd geocoder
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Use the built-in A1 list:
python geocoder.py

# Or provide your own input (JSON array of {"Naam": ..., "Snelweg": ...}):
python geocoder.py --input my_pois.json --output ../data/a1_poi.json
```

## Notes

- Respects the [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/):
  max 1 request/second and a descriptive `user_agent`. Update the contact in
  `TruckGeocoder.user_agent` before any serious use.
- Coordinates are written as decimal-degree floats (e.g. `52.3205346`) — the
  format the backend and frontend expect.
- `Match_Valide` flags whether an actual `highway=services` / `rest_area` /
  `amenity=fuel` object was found (vs. a rough fallback point).
