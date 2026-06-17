#!/usr/bin/env bash
#
# Dev helper: serve the static frontend on http://localhost:8000
# The backend API is expected to run separately on :8080
# (see README.md -> "Local development").
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/frontend"

echo "Navigeren naar de frontend map..."
echo "Webserver starten op http://localhost:8000"
echo "Druk op Ctrl+C om de server te stoppen."
exec python3 -m http.server 8000
