#!/usr/bin/env bash
# ============================================================
# wait-for.sh — ожидание готовности сервисов
# Использование: ./scripts/wait-for.sh postgres 5432 60
# ============================================================

set -euo pipefail

HOST="${1:?host required}"
PORT="${2:?port required}"
TIMEOUT="${3:-60}"

echo "⏳ Жду ${HOST}:${PORT} (таймаут ${TIMEOUT}s)..."

for i in $(seq 1 "${TIMEOUT}"); do
  if nc -z "${HOST}" "${PORT}" 2>/dev/null; then
    echo "✅ ${HOST}:${PORT} готов"
    exit 0
  fi
  sleep 1
done

echo "❌ Таймаут ожидания ${HOST}:${PORT}"
exit 1