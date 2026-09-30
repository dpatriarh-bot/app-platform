// ============================================================
// lib/consent.ts — ре-согласие с офертой при смене версии
// ============================================================

import { h } from './dom.js';
import { icon } from './icons.js';
import { api, isApiError } from './api.js';
import { openModal } from './modal.js';
import { toastSuccess, toastError } from './toast.js';
import { store } from './store.js';

let prompted = false;

export async function ensureConsent(): Promise<void> {
  if (prompted) return;

  const user = store.getState().user;
  if (!user) return;
  if (user.role !== 'parent') return;

  try {
    const res = await api.get<{ version: string }>('/auth/consent-version');
    const current = user.consentVersion ?? null;

    if (current === res.version) return;

    prompted = true;
    await showConsentModal(res.version);
  } catch {
    // не блокируем приложение
  }
}

function showConsentModal(version: string): Promise<void> {
  return new Promise((resolve) => {
    let agreed = false;

    const close = openModal({
      title: 'Обновление оферты',
      body: h('div', { class: 'stack' },
        h('div', { class: 'alert alert-info' },
          icon('info', { size: 18, className: 'icon icon-sm alert-icon' }),
          h('div', null,
            h('div', { class: 'alert-title' }, 'Мы обновили оферту'),
            'Чтобы продолжить пользоваться платформой, подтвердите согласие с новой редакцией.'
          )
        ),
        h('p', { class: 'text-sm text-muted' },
          'Новая версия: ', h('strong', null, version), '. ',
          'Это требование 152-ФЗ при юридически значимых изменениях.'
        ),
        h('div', { class: 'row gap-2 mt-4' },
          h('a', { class: 'btn btn-secondary', href: '#/about', target: '_blank' }, 'Открыть оферту')
        )
      ),
      size: 'md',
      actions: [
        {
          label: 'Принимаю',
          variant: 'primary',
          closeOnClick: false,
          onClick: async () => {
            try {
              await api.post('/auth/accept-consent', { version });
              agreed = true;
              const s = store.getState();
              if (s.user) {
                store.setState({ user: { ...s.user, consentVersion: version } });
              }
              toastSuccess('Согласие обновлено');
              close();
              resolve();
              return true;
            } catch (err) {
              toastError(isApiError(err) ? err.message : 'Не удалось сохранить согласие');
              return false;
            }
          },
        },
      ],
      onClose: () => {
        if (!agreed) {
          void api.post('/auth/logout', {}).catch(() => {});
          store.reset();
          window.location.hash = '#/login';
          setTimeout(() => window.location.reload(), 300);
        }
        resolve();
      },
    });
  });
}