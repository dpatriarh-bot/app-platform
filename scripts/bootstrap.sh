#!/usr/bin/env bash
# ============================================================
# bootstrap.sh — первичная настройка проекта
# Создаёт .env, генерирует секреты, поднимает контейнеры,
# применяет миграции, наполняет seed.
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${ROOT_DIR}"

echo "🚀 Bootstrap проекта «Улыбка ребёнка»"
echo ""

# ---------- Проверки ----------
if ! command -v docker >/dev/null 2>&1; then
  echo "❌ Docker не установлен"
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "❌ Docker Compose v2 не установлен"
  exit 1
fi

# ---------- .env ----------
if [ -f .env ]; then
  echo "⚠️  .env уже существует. Пропускаю создание."
  echo "   Если хотите пересоздать — удалите .env и запустите снова."
else
  echo "📝 Создаю .env из .env.example..."

  if command -v openssl >/dev/null 2>&1; then
    cp .env.example .env

    JWT_ACCESS=$(openssl rand -base64 48 | tr -d '\n')
    JWT_REFRESH=$(openssl rand -base64 48 | tr -d '\n')
    PII_HASH=$(openssl rand -base64 32 | tr -d '\n')
    PII_ENC=$(openssl rand -base64 32 | tr -d '\n')
    SESSION=$(openssl rand -base64 48 | tr -d '\n')
    CSRF=$(openssl rand -base64 48 | tr -d '\n')
    PG_PASS=$(openssl rand -base64 24 | tr -d '\n/+=' | head -c 32)
    REDIS_PASS=$(openssl rand -base64 24 | tr -d '\n/+=' | head -c 32)
    MINIO_PASS=$(openssl rand -base64 24 | tr -d '\n/+=' | head -c 32)

    sed -i.bak \
      -e "s|^JWT_ACCESS_SECRET=.*|JWT_ACCESS_SECRET=${JWT_ACCESS}|" \
      -e "s|^JWT_REFRESH_SECRET=.*|JWT_REFRESH_SECRET=${JWT_REFRESH}|" \
      -e "s|^PII_HASH_KEY=.*|PII_HASH_KEY=${PII_HASH}|" \
      -e "s|^PII_ENCRYPTION_KEY=.*|PII_ENCRYPTION_KEY=${PII_ENC}|" \
      -e "s|^SESSION_SECRET=.*|SESSION_SECRET=${SESSION}|" \
      -e "s|^CSRF_SECRET=.*|CSRF_SECRET=${CSRF}|" \
      -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${PG_PASS}|" \
      -e "s|^DATABASE_URL=.*|DATABASE_URL=postgres://ulybka:${PG_PASS}@postgres:5432/ulybka|" \
      -e "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=${REDIS_PASS}|" \
      -e "s|^REDIS_URL=.*|REDIS_URL=redis://:${REDIS_PASS}@redis:6379|" \
      -e "s|^MINIO_ROOT_PASSWORD=.*|MINIO_ROOT_PASSWORD=${MINIO_PASS}|" \
      .env

    rm -f .env.bak
    echo "✅ .env создан и заполнен секретами"
  else
    echo "⚠️  openssl не найден. Копирую .env.example как .env."
    echo "   Заполните секреты вручную перед запуском."
    cp .env.example .env
  fi
fi

echo ""

# ---------- Сборка и запуск ----------
echo "🐳 Собираю и поднимаю контейнеры (это может занять 3-5 минут)..."
docker compose up -d --build

echo ""
echo "⏳ Жду готовности Postgres..."
until docker compose exec -T postgres pg_isready -U ulybka -d ulybka >/dev/null 2>&1; do
  sleep 1
done

echo "⏳ Жду готовности API..."
until curl -fsS http://localhost:${API_PORT:-3000}/health >/dev/null 2>&1; do
  sleep 2
done

echo ""

# ---------- Миграции + seed ----------
echo "🗄️  Применяю миграции..."
docker compose exec -T api npm run db:migrate

echo "🌱 Наполняю базу демо-данными..."
docker compose exec -T api npm run db:seed

echo ""
echo "✅ Готово!"
echo ""
echo "🌐 Откройте в браузере:"
echo "   http://localhost"
echo ""
echo "🔑 Демо-аккаунты (пароль Demo12345!):"
echo "   Родитель:    +79000000001"
echo "   Куратор:     +79000000002"
echo "   Админ:       +79000000003"
echo "   Супер-админ: +79000000004"
echo ""
echo "📊 Полезные сервисы:"
echo "   API health:     http://localhost/health"
echo "   MinIO console:  http://localhost:${MINIO_CONSOLE_PORT:-9001}"
echo ""
echo "📋 Логи: docker compose logs -f api"
echo "🛑 Стоп: docker compose down"
echo "🗑️  Полный сброс: docker compose down -v"