# Truck App

A planning dashboard for truck fleets: plan routes, get rush-hour-aware travel
times, see EU rest-stop suggestions along the way, and manage vehicles,
drivers and trips. Built around a dataset of Dutch motorway rest areas / fuel /
service stops geocoded from OpenStreetMap.

> Status: works locally end-to-end. Authentication is still a **mock** and the
> data is **single-tenant** — see [Roadmap](#roadmap) before exposing this
> publicly.

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
│   ├── tests/              # pytest API tests
│   ├── requirements*.txt
│   ├── pyproject.toml      # ruff + pytest config
│   └── Dockerfile
├── frontend/
│   ├── index.html / style.css / script.js / config.js
│   ├── nginx.conf          # serves static + proxies /api -> backend
│   └── Dockerfile
├── geocoder/
│   └── geocoder.py
├── data/
│   └── a1_poi.json         # POI seed (replace with your full dataset)
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
| GET    | `/api/pois`           | All rest stops / fuel / POIs |
| GET/POST/PUT/DELETE | `/api/vehicles`       | Fleet CRUD      |
| GET/POST/PUT/DELETE | `/api/drivers`        | Drivers CRUD    |
| GET/POST/PATCH/DELETE | `/api/trips`        | Trips CRUD (PATCH for status) |

## Refreshing the POI dataset

```bash
cd geocoder
pip install -r requirements.txt
python geocoder.py --output ../data/a1_poi.json
```

Then restart the backend with an empty `pois` table (delete `data/truckapp.db`
or `TRUNCATE`) to re-seed. See `geocoder/README.md`.

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
5. **Backups & deployment** — automated DB backups; deploy behind HTTPS.
