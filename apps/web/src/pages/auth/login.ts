// ============================================================
// pages/auth/login.ts — вход с hCaptcha
// ============================================================

import { h } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { api, isApiError } from '../../lib/api.js';
import { store } from '../../lib/store.js';
import { router } from '../../lib/router.js';
import { field, passwordField, checkboxField, form } from '../../components/form.js';
import { captchaField, type CaptchaHandle } from '../../components/captcha.js';
import { toastSuccess, toastError } from '../../lib/toast.js';
import { validatePhone } from '../../lib/validation.js';
import { setRoot } from '../../components/layout.js';

export async function renderLogin(): Promise<void> {
  const returnUrl = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('return');

  const phone = field({
    name: 'phone',
    label: 'Телефон',
    type: 'tel',
    required: true,
    placeholder: '+7 (___) ___-__-__',
    autocomplete: 'tel',
    inputMode: 'tel',
    validate: validatePhone,
  });

  const password = passwordField({
    name: 'password',
    label: 'Пароль',
    required: true,
    autocomplete: 'current-password',
  });

  const rememberMe = checkboxField({
    name: 'rememberMe',
    label: 'Запомнить меня',
    checked: true,
  });

  const captcha: CaptchaHandle = await captchaField();

  let totpHandle: ReturnType<typeof field> | null = null;
  let requiresTotp = false;

  const totpContainer = h('div', { class: 'hide' });

  const f = form({
    fields: [phone.root, password.root, totpContainer, rememberMe.root, captcha.root],
    submitLabel: 'Войти',
    onSubmit: async () => {
      const okPhone = phone.validate();
      const okPass = password.validate();
      if (requiresTotp && totpHandle) {
        const ok = totpHandle.validate();
        if (!okPhone || !okPass || !ok) return;
      } else if (!okPhone || !okPass) {
        return;
      }

      f.setSubmitError(null);

      try {
        const payload: Record<string, unknown> = {
          phone: phone.getValue(),
          password: password.getValue(),
          rememberMe: rememberMe.isChecked(),
          captchaToken: captcha.getToken() ?? undefined,
        };
        if (requiresTotp && totpHandle) {
          payload.totp = totpHandle.getValue();
        }

        const res = await api.post<{
          user?: {
            id: string;
            role: 'parent' | 'partner' | 'manager' | 'curator' | 'admin' | 'superadmin';
            status: string;
            phone: string;
            email: string | null;
            totpEnabled: boolean;
          };
          requiresTotp?: boolean;
          mustChangePassword?: boolean;
          consentUpdateRequired?: boolean;
        }>('/auth/login', payload);

        if (res.requiresTotp) {
          requiresTotp = true;
          if (!totpHandle) {
            totpHandle = field({
              name: 'totp',
              label: 'Код из приложения',
              required: true,
              inputMode: 'numeric',
              maxLength: 6,
              placeholder: '000000',
              hint: 'Введите 6-значный код из Google Authenticator / Authy или резервный код',
            });
            totpContainer.replaceChildren(totpHandle.root);
            totpContainer.classList.remove('hide');
          }
          f.setSubmitError('Требуется код двухфакторной аутентификации');
          return;
        }

        if (res.user) {
          store.setState({ user: res.user });
          toastSuccess('Добро пожаловать!');
          router.navigate(returnUrl ? decodeURIComponent(returnUrl) : '/app');
        }
      } catch (err) {
        if (isApiError(err)) {
          if (err.status === 422 && err.details && typeof err.details === 'object') {
            const details = err.details as { fields?: Record<string, string> };
            if (details.fields) {
              applyFieldErrors(details.fields, { phone, password });
            }
          }
          if (err.code === 'CAPTCHA_FAILED') {
            captcha.reset();
          }
          f.setSubmitError(err.message);
          toastError(err.message);
        } else {
          f.setSubmitError('Не удалось войти. Проверьте соединение.');
        }
      }
    },
    secondaryAction: h('div', { class: 'row-between' },
      h('a', { class: 'text-sm', href: '#/forgot' }, 'Забыли пароль?'),
      h('a', { class: 'text-sm', href: '#/register' }, 'Регистрация')
    ),
  });

  const content = h('div', { class: 'center', style: 'min-height:100vh;padding:24px;' },
    h('div', { style: 'width:100%;max-width:420px;' },
      h('div', { class: 'text-center mb-6' },
        h('a', { href: '#/' },
          h('img', {
            src: '/logo.svg',
            alt: '',
            style: 'width:56px;height:56px;border-radius:14px;margin:0 auto 12px;',
          })
        ),
        h('h2', null, 'Вход'),
        h('p', { class: 'text-muted text-sm mt-2' }, 'Войдите в личный кабинет')
      ),
      h('div', { class: 'card card-pad-lg' }, f.root)
    )
  );

  setRoot(content);
  phone.input.focus();
}

function applyFieldErrors(
  fields: Record<string, string>,
  handles: Record<string, { setError: (msg: string | null) => void }>
): void {
  for (const [name, message] of Object.entries(fields)) {
    const handle = handles[name];
    if (handle) {
      handle.setError(message);
    } else if (name.startsWith('child.')) {
      const childField = name.split('.')[1];
      const h2 = handles[`child.${childField}`];
      if (h2) h2.setError(message);
    }
  }
}

export { applyFieldErrors };