#!/usr/bin/env bash
# ============================================================
# backup.sh — шифрованный бэкап Postgres
# Дамп + gpg-шифрование + ротация по дням
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${ROOT_DIR}"

# ---------- Загрузка .env ----------
if [ ! -f .env ]; then
  echo "❌ .env не найден"
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

# ---------- Настройки ----------
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION="${BACKUP_RETENTION_DAYS:-30}"
GPG_RECIPIENT="${BACKUP_GPG_RECIPIENT:-}"

mkdir -p "${BACKUP_DIR}"

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
DAY="$(date +%Y%m%d)"
FILENAME="ulybka_${TIMESTAMP}.sql"
ARCHIVE="${FILENAME}.gz"

echo "🗄️  Создаю дамп БД..."
docker compose exec -T postgres pg_dump \
  -U "${POSTGRES_USER:-ulybka}" \
  -d "${POSTGRES_DB:-ulybka}" \
  --no-owner --no-privileges --clean --if-exists \
  > "${BACKUP_DIR}/${FILENAME}"

echo "📦 Сжимаю..."
gzip -9 "${BACKUP_DIR}/${FILENAME}"

FINAL="${BACKUP_DIR}/${ARCHIVE}"

# ---------- Шифрование (опционально) ----------
if [ -n "${GPG_RECIPIENT}" ] && command -v gpg >/dev/null 2>&1; then
  echo "🔐 Шифрую gpg..."
  gpg --batch --yes --encrypt --recipient "${GPG_RECIPIENT}" "${FINAL}"
  rm -f "${FINAL}"
  FINAL="${FINAL}.gpg"
fi

# ---------- Валидация ----------
if [ ! -s "${FINAL}" ]; then
  echo "❌ Бэкап пустой или не создан"
  exit 1
fi

SIZE="$(du -h "${FINAL}" | cut -f1)"
echo "✅ Бэкап: ${FINAL} (${SIZE})"

# ---------- Offsite (опционально S3/MinIO) ----------
if [ -n "${BACKUP_S3_ENDPOINT:-}" ] && command -v mc >/dev/null 2>&1; then
  echo "☁️  Загружаю в S3..."
  mc alias set backup "${BACKUP_S3_ENDPOINT}" "${BACKUP_S3_ACCESS_KEY}" "${BACKUP_S3_SECRET_KEY}"
  mc cp "${FINAL}" "backup/${BACKUP_S3_BUCKET:-ulybka-backups}/$(basename "${FINAL}")"
  echo "✅ Загружено в S3"
fi

# ---------- Ротация ----------
echo "🧹 Удаляю бэкапы старше ${RETENTION} дней..."
find "${BACKUP_DIR}" -name "ulybka_*.sql.gz*" -mtime "+${RETENTION}" -delete

echo "✅ Готово"