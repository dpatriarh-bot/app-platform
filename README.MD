# Улыбка ребёнка — веб-платформа

Платформа детского образовательного центра: публичный сайт, личный кабинет
родителя и ребёнка, интерактивные тесты, система баллов, подписка, каталог
подарков от партнёров, административная панель с антифродом и очными
проверками.

## Стек

- **Backend:** Node.js 20 LTS, Fastify, Drizzle ORM, PostgreSQL 16, Redis 7
- **Frontend:** Vanilla TypeScript + Vite, собственный UI-кит
- **Инфраструктура:** Docker Compose, Nginx, MinIO (S3)
- **Иконки:** Feather (self-hosted SVG-спрайт)
- **Шрифты:** Inter, JetBrains Mono (self-hosted)

## Требования

- Docker 24+
- Docker Compose v2
- 2 GB RAM минимум, 4 GB рекомендуется
- Свободные порты: 80, 443, 3000, 5173, 5432, 6379, 9000, 9001

## Быстрый старт (dev)

```bash
cp .env.example .env
# Отредактируйте .env: пароли, секреты (см. комментарии в файле)
docker compose up -d --build
docker compose exec api npm run db:migrate
docker compose exec api npm run db:seed