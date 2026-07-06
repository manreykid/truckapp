# Truck App

A planning dashboard for truck fleets: plan routes, get rush-hour-aware travel
times, see EU rest-stop suggestions along the way, and manage vehicles,
drivers and trips. Built around a dataset of Dutch motorway rest areas / fuel /
service stops geocoded from OpenStreetMap.

> Status: works locally end-to-end. Authentication is still a **mock** and the
> data is **single-tenant** — see [Roadmap](#roadmap) before exposing this
> publicly.

## Features

- **Route planner** (Leaflet + OSRM) with address search, a Dutch rush-hour
  heuristic on the expected travel time, and **multi-stop EU rest planning**:
  one suggested rest stop per 4.5 hours of driving (EU regulation 561/2006),
  drawn on the map and listed in the summary.
- **Trip workflow**: plan → assign vehicle & driver → save; then move each trip
  through *Gepland → Onderweg → Afgerond/Geannuleerd* from the trips overview.
  Every trip can be re-opened on the map with one click.
- **Dashboard tiles**: planned trips, trips underway, vehicles, drivers —
  served by `/api/stats`.
- **Fleet management**: vehicles and drivers CRUD, with assignment shown per
  trip (joined server-side).
- **POI dataset tooling**: an offline geocoder (name → validated coordinates
  via OSM tags) and a Firebase/Firestore import tool for existing data.

## Architecture

```
Browser ──HTTP──> Frontend (static: Leaflet map + dashboard)
                      │  /api/* (reverse-proxied in prod)
                      ▼
                  Backend (FastAPI)  ──>  SQLite (truckapp.db)
                      ▲
                      │ seeds on first start
                  data/a1_poi.json  <──  geocoder/geocoder.py (offline tool)
```

- **frontend/** — vanilla JS + Leaflet, served as static files (nginx in prod).
- **backend/** — FastAPI app (`app/`), SQLite via a thin data layer, tests.
- **geocoder/** — offline tool that produces `data/a1_poi.json`.
- **data/** — seed data + the runtime SQLite database (gitignored).

## Project layout

```
truckapp/
├── docker-compose.yml      # run the whole stack
├── Makefile                # dev shortcuts
├── start.sh                # serve frontend on :8000 (dev)
├── backend/
│   ├── app/                # config, database, crud, models, routers, main
│   ├── tests/              # pytest API + import-tool tests
│   ├── requirements*.txt
│   ├── pyproject.toml      # ruff + pytest config
│   └── Dockerfile
├── frontend/
│   ├── index.html / style.css / config.js
│   ├── js/                 # ES modules: app, ui, map, api, utils
│   ├── nginx.conf          # serves static + proxies /api -> backend
│   └── Dockerfile
├── geocoder/
│   ├── geocoder.py
│   └── input/nl_snelweg_pois.json   # master list: rest stops per highway
├── tools/
│   └── import_firebase.py  # Firestore export -> seed/DB converter
├── data/
│   └── a1_poi.json         # POI seed (legacy name; may span all highways)
└── .github/workflows/ci.yml
```

## Quick start (Docker)

```bash
docker compose up --build
# open http://localhost:8000   (login is a mock: just click "Lokaal Inloggen")
```

The backend creates `data/truckapp.db` and seeds it from `data/a1_poi.json` on
first run. The database file persists in `./data` between restarts.

## Local development (without Docker)

Two terminals.

**Backend** (`:8080`):

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8080      # or: make backend
```

**Frontend** (`:8000`):

```bash
./start.sh                                       # or: make frontend
```

`frontend/config.js` automatically points the UI at `http://localhost:8080/api`
when served on `:8000`, and at the same-origin `/api` when behind nginx.

## Configuration

Copy `.env.example` to `.env` (read by the backend). Key settings:

| Variable          | Default                                          | Purpose                                  |
| ----------------- | ------------------------------------------------ | ---------------------------------------- |
| `DATABASE_PATH`   | `data/truckapp.db`                               | SQLite file (relative to repo root)      |
| `DATA_SEED_FILE`  | `data/a1_poi.json`                               | POI seed loaded when the table is empty  |
| `ALLOWED_ORIGINS` | `http://localhost:8000,http://localhost:8080`    | CORS allow-list (lock down in prod)      |
| `LOG_LEVEL`       | `info`                                           | Logging verbosity                        |

## API

Interactive docs at `http://localhost:8080/docs` when the backend is running.

| Method | Path                  | Description                  |
| ------ | --------------------- | ---------------------------- |
| GET    | `/api/health`         | Health check                 |
| GET    | `/api/stats`          | Dashboard counters (vehicles, drivers, trips by status) |
| GET    | `/api/pois`           | All rest stops / fuel / POIs |
| GET/POST/PUT/DELETE | `/api/vehicles`       | Fleet CRUD      |
| GET/POST/PUT/DELETE | `/api/drivers`        | Drivers CRUD    |
| GET/POST/PATCH/DELETE | `/api/trips`        | Trips CRUD; responses include `vehiclePlate`/`driverName`; PATCH validates status (`Gepland`/`Onderweg`/`Afgerond`/`Geannuleerd`) |

Trip listing is enriched server-side with the assigned vehicle plate and
driver name, so clients never join collections themselves.

## Refreshing the POI dataset

Two supported routes:

**A. Import an existing Firebase/Firestore export** (recommended if you
already collected POIs there):

```bash
# 1. Export on the machine that has the Firebase service-account key
#    (see tools/import_firebase.py docstring for an export snippet).
# 2. Convert + load:
python3 tools/import_firebase.py pois_export.json                     # writes data/a1_poi.json
python3 tools/import_firebase.py pois_export.json --db data/truckapp.db --replace
```

The converter normalises field-name variants, reads Firestore GeoPoints, and
automatically repairs legacy integer-encoded coordinates
(`523205346` → `52.3205346`).

**B. Geocode from scratch** with the offline geocoder:

```bash
cd geocoder
pip install -r requirements.txt
python geocoder.py --input input/nl_snelweg_pois.json --output ../data/a1_poi.json
```

Either way: restart the backend with an empty `pois` table (delete
`data/truckapp.db`) to re-seed from the JSON, or use `--db ... --replace` to
write into the live database directly. See `geocoder/README.md`.

## Testing & linting

```bash
cd backend
pytest -q          # or: make test
ruff check .       # or: make lint
```

CI (`.github/workflows/ci.yml`) runs both on every push and PR.

## Notable fixes vs. the original prototype

- **Coordinate bug fixed.** The old frontend stored coordinates as integers and
  divided by a power of ten based on digit count, which broke as soon as the API
  served real floats (markers ended up near 0°,0°). Coordinates are now plain
  decimal-degree floats end to end, validated rather than transformed.
- **Config & CORS** are environment-driven instead of hardcoded `localhost` /
  `allow_origins=["*"]`.
- **Modern FastAPI lifespan** replaces the deprecated `@app.on_event`.
- **Project structure, tests, CI, Docker** added for reproducible runs.

## Roadmap

Production-hardening still to do (deliberately deferred this round):

1. **Real authentication** — replace the mock login with JWT-based auth.
2. **Multi-tenancy** — scope vehicles/drivers/trips per company/user (add an
   owner column + filter by the authenticated user). Currently all data is
   global/shared.
3. **Truck-aware routing** — the public OSRM demo only routes cars. Integrate a
   provider that respects bridge heights / axle weights (Mapbox, TomTom,
   GraphHopper) and consider live traffic instead of the rush-hour heuristic.
4. **PostgreSQL + PostGIS** — migrate from SQLite when going multi-user; only
   `backend/app/database.py` and `crud.py` should need changes.
5. **Vendor frontend libraries** — Leaflet & plugins are loaded from CDNs;
   bundling them into `frontend/vendor/` removes the third-party dependency
   (the dashboard already degrades gracefully if the CDN is unreachable).
6. **Backups & deployment** — automated DB backups; deploy behind HTTPS.
