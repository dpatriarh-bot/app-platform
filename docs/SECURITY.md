# Безопасность

## Модель угроз

### Активы

- PII детей (ФИО, дата рождения, школа).
- Учётные записи родителей (телефон, email, платёжные данные).
- Результаты тестов и баллы (мошенничество → подделка подарков).
- Платёжные токены (хранятся у провайдера, у нас — только ID).

### Угрозы

| Угроза | Вектор | Мера |
|---|---|---|
| Перебор пароля | /auth/login | Rate-limit 5/15мин, капча, Argon2id |
| Кража сессии | XSS, MITM | httpOnly+Secure+SameSite, HTTPS, CSP |
| CSRF | Сторонний сайт | Double-submit cookie + Origin check |
| SQLi | Поля ввода | Параметризованные запросы (Drizzle) |
| XSS | Rich-текст, ФИО | textContent + DOMPurify, CSP nonce |
| IDOR | Чужие attempt_id | Проверка owner на каждом эндпоинте |
| Fraud (ИИ-прохождение) | Бот | attempt_events + suspicion_score + spot-check |
| Подделка платежа | Вебхук | HMAC + IP allowlist + idempotency |
| Утечка PII | Логи, бэкапы | Redact, шифрование at-rest |
| Open Redirect | return_url | Allowlist относительных путей |
| SSRF | URL в вебхуках | Allowlist доменов |
| Clickjacking | iframe | X-Frame-Options + frame-ancestors |

## Криптография

- Пароли: Argon2id (19 MiB, t=2, p=1).
- PII: AES-256-GCM, ключ в env (позже — KMS).
- Поиск по ФИО: HMAC-SHA256 (PII_HASH_KEY).
- JWT: HS256 для access, HS256+rotation для refresh.
- CSRf: HMAC-SHA256 (CSRF_SECRET).
- QR-коды партнёров: JWT с nonce, TTL 10 мин.

## 152-ФЗ

- Согласие родителя хранится с версией оферты.
- Право на удаление — soft-delete + фоновая очистка.
- Выгрузка данных — эндпоинт /me/export.
- Локализация — все ПД на территории РФ.

## Аудит

- Таблица audit_log: actor, action, entity, before/after, ip, ua.
- Write-only. Чтение — только superadmin через отдельный эндпоинт.
- Ротация: 1 год hot, 3 года cold.