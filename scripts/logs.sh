#!/usr/bin/env bash
# ============================================================
# logs.sh — просмотр логов выбранного сервиса
# Использование: ./scripts/logs.sh api
# ============================================================

set -euo pipefail

SERVICE="${1:-api}"

docker compose logs -f --tail=200 "${SERVICE}"