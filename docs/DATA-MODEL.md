users               — id, role, phone (E.164), email, password_hash, 
                      totp_secret, status, created_at, consent_version, consent_at
parents             — user_id → users, full_name (encrypted), 
                      fio_hash (для поиска)
children            — id, parent_id → parents, full_name (enc), birth_date (enc), 
                      fio_hash, city, school, grade
sessions            — id, user_id, refresh_hash, ua, ip, expires_at, revoked_at
permissions         — role, resource, action  (матрица RBAC)
subjects            — id, title, slug, age_min, age_max, grade_min, grade_max, icon
tests               — id, subject_id, title, description, time_limit_sec, 
                      status (draft|review|published|archived), 
                      points_fixed, points_per_correct, created_by
questions           — id, test_id, order, text, type (input|single|multi), 
                      correct_answer, explanation
attempts            — id, child_id, test_id, started_at, finished_at, 
                      score, correct_count, total_count, time_spent, 
                      connection_drops
attempt_answers     — id, attempt_id, question_id, user_answer, is_correct
points_ledger       — id, child_id, delta, reason, attempt_id, 
                      created_at, idempotency_key  (UNIQUE)
subscriptions       — id, parent_id, status, plan_id, 
                      current_period_start, current_period_end, 
                      auto_renew, payment_method_id
payments            — id, subscription_id, provider, provider_payment_id, 
                      amount, status, receipt_url, created_at
plans               — id, name, price_rub, period_days
partner_offers      — id, partner_id, title, cost_points, stock, terms
redemptions         — id, child_id, offer_id, status, code, created_at
spot_checks         — id, child_id, scheduled_at, started_at, finished_at, 
                      status, curator_id, verdict, notes
spot_check_items    — id, spot_check_id, question_id, answer, is_correct
mailings            — id, template_id, segment, scheduled_at, status
mail_templates      — id, code, subject, body_html, variables
audit_log           — id, actor_id, action, entity, entity_id, 
                      before_json, after_json, ip, ua, created_at