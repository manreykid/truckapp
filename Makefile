# Convenience targets for local development.
# Run `make help` to list them.

.PHONY: help backend frontend test lint up down build

help:
	@echo "Targets:"
	@echo "  make backend   - run the API (uvicorn) on :8080 with reload"
	@echo "  make frontend  - serve the static frontend on :8000"
	@echo "  make test      - run backend tests"
	@echo "  make lint      - run ruff on the backend"
	@echo "  make up         - start the whole stack with Docker Compose"
	@echo "  make down       - stop the Docker Compose stack"

backend:
	cd backend && uvicorn app.main:app --reload --host 0.0.0.0 --port 8080

frontend:
	./start.sh

test:
	cd backend && pytest -q

lint:
	cd backend && ruff check .

up:
	docker compose up --build

down:
	docker compose down
