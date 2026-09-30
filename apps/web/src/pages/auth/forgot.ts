// ============================================================
// pages/auth/forgot.ts — запрос сброса пароля (email/SMS)
// ============================================================

import { h } from '../../lib/dom.js';
import { api, isApiError } from '../../lib/api.js';
import { field, form } from '../../components/form.js';
import { captchaField, type CaptchaHandle } from '../../components/captcha.js';
import { toastSuccess, toastError } from '../../lib/toast.js';
import { validatePhone } from '../../lib/validation.js';
import { setRoot } from '../../components/layout.js';

type Method = 'email' | 'sms';

export async function renderForgot(): Promise<void> {
  let method: Method = 'email';

  const phone = field({
    name: 'phone',
    label: 'Телефон',
    type: 'tel',
    required: true,
    placeholder: '+7 (___) ___-__-__',
    inputMode: 'tel',
    autocomplete: 'tel',
    validate: validatePhone,
  });

  const methodHost = h('div', { class: 'tabs tabs-pills', style: 'margin-bottom: var(--sp-4);' });

  const renderMethods = (): void => {
    methodHost.replaceChildren(
      h('button', {
        class: `tab ${method === 'email' ? 'is-active' : ''}`,
        type: 'button',
        onclick: () => { method = 'email'; renderMethods(); },
      }, 'По email'),
      h('button', {
        class: `tab ${method === 'sms' ? 'is-active' : ''}`,
        type: 'button',
        onclick: () => { method = 'sms'; renderMethods(); },
      }, 'По SMS')
    );
  };
  renderMethods();

  const captcha: CaptchaHandle = await captchaField();

  let sent = false;

  const f = form({
    fields: [methodHost, phone.root, captcha.root],
    submitLabel: 'Отправить',
    onSubmit: async () => {
      if (sent) return;
      if (!phone.validate()) return;
      f.setSubmitError(null);

      try {
        const res = await api.post<{ ok: boolean; method: Method | 'none'; message: string }>(
          '/auth/forgot',
          {
            phone: phone.getValue(),
            method,
            captchaToken: captcha.getToken() ?? undefined,
          }
        );
        sent = true;
        f.setSubmitSuccess(res.message);
        toastSuccess('Запрос отправлен');
      } catch (err) {
        if (isApiError(err)) {
          if (err.code === 'CAPTCHA_FAILED') captcha.reset();
          f.setSubmitError(err.message);
          toastError(err.message);
        } else {
          f.setSubmitError('Не удалось отправить запрос. Проверьте соединение.');
        }
      }
    },
    secondaryAction: h('div', { class: 'text-center text-sm text-muted' },
      'Вспомнили пароль? ',
      h('a', { href: '#/login' }, 'Войти')
    ),
  });

  const content = h('div', { class: 'center', style: 'min-height:100vh;padding:24px;' },
    h('div', { style: 'width:100%;max-width:420px;' },
      h('div', { class: 'text-center mb-6' },
        h('h2', null, 'Восстановление пароля'),
        h('p', { class: 'text-muted text-sm mt-2' },
          'Выберите способ восстановления. Если аккаунт существует — мы отправим ссылку или код.'
        )
      ),
      h('div', { class: 'card card-pad-lg' }, f.root)
    )
  );

  setRoot(content);
  phone.input.focus();
}