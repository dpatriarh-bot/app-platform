-- ============================================================
-- init.sql — инициализация PostgreSQL
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS btree_gin;

ALTER DATABASE ulybka SET timezone TO 'Europe/Moscow';
ALTER DATABASE ulybka SET statement_timeout TO '30s';
ALTER DATABASE ulybka SET idle_in_transaction_session_timeout TO '60s';

CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS analytics;

COMMENT ON SCHEMA audit IS 'Журнал действий пользователей и администраторов';
COMMENT ON SCHEMA analytics IS 'Материализованные представления для отчётов';