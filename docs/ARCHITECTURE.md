# Архитектура

## Обзор

Платформа состоит из трёх слоёв:

1. **Клиент (SPA)** — публичный сайт + личный кабинет + админка.
   Один bundle, роутинг по hash. Авторизация — через httpOnly cookie.
2. **API (Fastify)** — REST, JSON Schema валидация, RBAC, audit log,
   антифрод-движок, работа с платежами (пока stub), рассылки.
3. **Данные** — PostgreSQL (основное), Redis (сессии, очереди,
   rate-limit), MinIO (файлы).

## Потоки данных

### Регистрация → подписка → тест

### Антифрод

- Во время теста клиент шлёт сигналы в `/attempts/:id/event`
  (focus_lost, copy_paste, mouse_move, typing_pattern, ip_change).
- Сервер пишет в `attempt_events`.
- После `finish` воркер BullMQ считает `suspicion_score`.
- Куратор видит flagged-попытки в `/admin/checks`.
- Может назначить очную проверку → случайная подборка вопросов
  → kiosk-режим → вердикт.

### Партнёры

- Партнёрская панель на `partners.ulybka.ru` (отдельный subdomain,
  тот же API, другая роль).
- 3 механики: QR (JWT с nonce), реферальная ссылка, промокод.
- Модерация офферов фондом.

## Безопасность

См. [SECURITY.md](SECURITY.md).