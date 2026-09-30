# ============================================================
# Makefile — удобные команды для работы с проектом
# ============================================================

SHELL := /bin/bash
COMPOSE := docker compose
COMPOSE_PROD := docker compose -f docker-compose.yml -f docker-compose.prod.yml

.PHONY: help
help:
	@echo "Улыбка ребёнка — доступные команды:"
	@echo ""
	@echo "  make init          — первичная настройка и запуск"
	@echo "  make up            — поднять dev-окружение"
	@echo "  make down          — остановить"
	@echo "  make restart       — перезапустить"
	@echo "  make rebuild       — пересобрать контейнеры"
	@echo "  make logs          — логи api"
	@echo "  make logs SERVICE=web — логи сервиса"
	@echo "  make shell         — shell в api"
	@echo "  make db-migrate    — применить миграции"
	@echo "  make db-seed       — наполнить демо-данными"
	@echo "  make db-reset      — сбросить БД (только dev!)"
	@echo "  make db-studio     — Drizzle Studio"
	@echo "  make backup        — бэкап БД"
	@echo "  make prod-up       — запустить production"
	@echo "  make prod-down     — остановить production"
	@echo "  make clean         — удалить всё (включая volumes)"
	@echo ""

.PHONY: init
init:
	@bash scripts/bootstrap.sh

.PHONY: up
up:
	$(COMPOSE) up -d

.PHONY: down
down:
	$(COMPOSE) down

.PHONY: restart
restart:
	$(COMPOSE) restart

.PHONY: rebuild
rebuild:
	$(COMPOSE) up -d --build

.PHONY: logs
logs:
	@bash scripts/logs.sh $(or $(SERVICE),api)

.PHONY: shell
shell:
	$(COMPOSE) exec api sh

.PHONY: shell-web
shell-web:
	$(COMPOSE) exec web sh

.PHONY: shell-db
shell-db:
	$(COMPOSE) exec postgres psql -U ulybka -d ulybka

.PHONY: db-migrate
db-migrate:
	$(COMPOSE) exec api npm run db:migrate

.PHONY: db-seed
db-seed:
	$(COMPOSE) exec api npm run db:seed

.PHONY: db-reset
db-reset:
	@echo "⚠️  Сброс БД. Продолжить? (Ctrl+C чтобы отменить)"
	@sleep 3
	$(COMPOSE) exec api npm run db:reset
	$(COMPOSE) exec api npm run db:migrate
	$(COMPOSE) exec api npm run db:seed

.PHONY: db-studio
db-studio:
	$(COMPOSE) exec api npm run db:studio

.PHONY: backup
backup:
	@bash scripts/backup.sh

.PHONY: prod-up
prod-up:
	$(COMPOSE_PROD) up -d --build

.PHONY: prod-down
prod-down:
	$(COMPOSE_PROD) down

.PHONY: prod-logs
prod-logs:
	$(COMPOSE_PROD) logs -f --tail=200 api

.PHONY: clean
clean:
	@echo "⚠️  Удаление всех контейнеров, volumes и образов проекта. Продолжить? (Ctrl+C чтобы отменить)"
	@sleep 3
	$(COMPOSE) down -v --remove-orphans
	docker rmi ulybka-api ulybka-web 2>/dev/null || true