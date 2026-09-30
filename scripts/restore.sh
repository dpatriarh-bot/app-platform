#!/usr/bin/env bash
# ============================================================
# restore.sh — восстановление БД из бэкапа
# Использование: ./scripts/restore.sh ./backups/ulybka_xxx.sql.gz
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${ROOT_DIR}"

if [ $# -lt 1 ]; then
  echo "Использование: $0 <backup.sql.gz[.gpg]>"
  exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "${BACKUP_FILE}" ]; then
  echo "❌ Файл ${BACKUP_FILE} не найден"
  exit 1
fi

# ---------- .env ----------
set -a
# shellcheck disable=SC1091
source .env
set +a

# ---------- Расшифровка gpg ----------
WORK_FILE="${BACKUP_FILE}"
if [[ "${BACKUP_FILE}" == *.gpg ]]; then
  echo "🔓 Расшифровываю gpg..."
  WORK_FILE="${BACKUP_FILE%.gpg}"
  gpg --batch --yes --output "${WORK_FILE}" --decrypt "${BACKUP_FILE}"
fi

# ---------- Распаковка ----------
if [[ "${WORK_FILE}" == *.gz ]]; then
  echo "📦 Распаковываю..."
  UNPACKED="${WORK_FILE%.gz}"
  gunzip -c "${WORK_FILE}" > "${UNPACKED}"
  WORK_FILE="${UNPACKED}"
fi

# ---------- Восстановление ----------
echo "⚠️  ВНИМАНИЕ: текущие данные будут перезаписаны!"
read -r -p "Продолжить? (yes/no): " CONFIRM
if [ "${CONFIRM}" != "yes" ]; then
  echo "Отменено"
  exit 0
fi

echo "🗄️  Восстанавливаю..."
docker compose exec -T postgres psql \
  -U "${POSTGRES_USER:-ulybka}" \
  -d "${POSTGRES_DB:-ulybka}" \
  < "${WORK_FILE}"

echo "✅ Восстановление завершено"

# ---------- Очистка временных ----------
[ "${WORK_FILE}" != "${BACKUP_FILE}" ] && rm -f "${WORK_FILE}"