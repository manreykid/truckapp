"""FastAPI application entrypoint."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .database import get_connection, init_db
from .routers import drivers, pois, stats, trips, vehicles
from .seed import seed_pois

logging.basicConfig(level=settings.log_level.upper())
log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialise and seed the database on startup."""
    init_db()
    with get_connection() as conn:
        seed_pois(conn)
    log.info("TruckApp API ready (origins: %s)", settings.origins_list)
    yield


app = FastAPI(title="TruckApp API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(pois.router)
app.include_router(vehicles.router)
app.include_router(drivers.router)
app.include_router(trips.router)
app.include_router(stats.router)


@app.get("/api/health", tags=["meta"])
def health() -> dict[str, str]:
    return {"status": "ok"}
