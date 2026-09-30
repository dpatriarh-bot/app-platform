// ============================================================
// pages/auth/reset.ts — установка нового пароля
// Поддерживает два сценария: email-токен и SMS-код.
// ============================================================

import { h } from '../../lib/dom.js';
import { api, isApiError } from '../../lib/api.js';
import { router } from '../../lib/router.js';
import { field, passwordField, form } from '../../components/form.js';
import { toastSuccess, toastError } from '../../lib/toast.js';
import {
  validatePassword,
  validatePasswordConfirm,
  validatePhone,
} from '../../lib/validation.js';
import { setRoot } from '../../components/layout.js';

export function renderReset(): void {
  const query = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
  const token = query.get('token') ?? '';
  const phoneFromQuery = query.get('phone') ?? '';

  // Если нет токена и нет телефона — показываем экран запроса
  if (!token && !phoneFromQuery) {
    setRoot(h('div', { class: 'center', style: 'min-height:100vh;padding:24px;' },
      h('div', { class: 'text-center', style: 'max-width:420px;' },
        h('h2', null, 'Некорректная ссылка'),
        h('p', { class: 'text-muted mt-2' }, 'Ссылка недействительна или истекла.'),
        h('div', { class: 'mt-4' },
          h('a', { class: 'btn', href: '#/forgot' }, 'Запросить новую')
        )
      )
    ));
    return;
  }

  const phone = phoneFromQuery
    ? field({
        name: 'phone',
        label: 'Телефон',
        type: 'tel',
        value: phoneFromQuery,
        required: true,
        inputMode: 'tel',
        validate: validatePhone,
      })
    : null;

  const code = phoneFromQuery
    ? field({
        name: 'code',
        label: 'Код из SMS',
        required: true,
        inputMode: 'numeric',
        maxLength: 6,
        placeholder: '000000',
        hint: '6 цифр, действует 10 минут',
      })
    : null;

  const password = passwordField({
    name: 'password',
    label: 'Новый пароль',
    required: true,
    autocomplete: 'new-password',
    validate: validatePassword,
    hint: 'Минимум 8 символов, латинские буквы и цифры',
  });

  const passwordConfirm = passwordField({
    name: 'passwordConfirm',
    label: 'Повторите пароль',
    required: true,
    autocomplete: 'new-password',
    validate: (v) => validatePasswordConfirm(password.getValue(), v),
  });

  const fields = [
    ...(phone ? [phone.root] : []),
    ...(code ? [code.root] : []),
    password.root,
    passwordConfirm.root,
  ];

  const f = form({
    fields,
    submitLabel: 'Сохранить пароль',
    onSubmit: async () => {
      const valid =
        (!phone || phone.validate()) &&
        (!code || code.validate()) &&
        password.validate() &&
        passwordConfirm.validate();
      if (!valid) return;

      f.setSubmitError(null);

      try {
        const payload: Record<string, unknown> = {
          password: password.getValue(),
          passwordConfirm: passwordConfirm.getValue(),
        };

        if (token) {
          payload.token = token;
        } else if (phone && code) {
          payload.phone = phone.getValue();
          payload.code = code.getValue();
        }

        await api.post('/auth/reset', payload);
        toastSuccess('Пароль обновлён');
        router.navigate('/login');
      } catch (err) {
        if (isApiError(err)) {
          f.setSubmitError(err.message);
          toastError(err.message);
        } else {
          f.setSubmitError('Не удалось сохранить пароль. Проверьте соединение.');
        }
      }
    },
  });

  const content = h('div', { class: 'center', style: 'min-height:100vh;padding:24px;' },
    h('div', { style: 'width:100%;max-width:420px;' },
      h('div', { class: 'text-center mb-6' },
        h('h2', null, 'Новый пароль'),
        h('p', { class: 'text-muted text-sm mt-2' },
          token
            ? 'Придумайте новый пароль. После сохранения все устройства будут разлогинены.'
            : 'Введите код из SMS и новый пароль.'
        )
      ),
      h('div', { class: 'card card-pad-lg' }, f.root)
    )
  );

  setRoot(content);
  (phone ?? password).input.focus();
}