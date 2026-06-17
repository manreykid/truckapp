"""Application configuration, loaded from environment variables / .env.

All settings have sensible local-development defaults so the app runs
out of the box, while production deployments override them via the
environment (see .env.example and docker-compose.yml).
"""

from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Repo root: backend/app/config.py -> parents[2] == <repo root>
BASE_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Storage
    database_path: str = "data/truckapp.db"
    data_seed_file: str = "data/a1_poi.json"

    # Security / networking
    allowed_origins: str = "http://localhost:8000,http://localhost:8080"
    host: str = "0.0.0.0"
    port: int = 8080

    # Observability
    log_level: str = "info"

    @property
    def origins_list(self) -> list[str]:
        """CORS origins as a clean list."""
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    def _resolve(self, value: str) -> Path:
        path = Path(value)
        return path if path.is_absolute() else BASE_DIR / path

    @property
    def database_file(self) -> Path:
        """Absolute path to the SQLite database file."""
        return self._resolve(self.database_path)

    @property
    def seed_file(self) -> Path:
        """Absolute path to the POI seed file."""
        return self._resolve(self.data_seed_file)


settings = Settings()
