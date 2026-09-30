// ============================================================
// pages/app/profile.ts — профиль родителя
// Табы: профиль, дети, безопасность, данные.
// В безопасность добавлены активные сессии.
// ============================================================

import { h, mount, clear } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { api, isApiError } from '../../lib/api.js';
import { store } from '../../lib/store.js';
import { router } from '../../lib/router.js';
import { appLayout, setRoot } from '../../components/layout.js';
import { emptyState, loader, pillsTabs } from '../../components/ui.js';
import { field, passwordField, selectField, form } from '../../components/form.js';
import { openModal, confirmModal } from '../../lib/modal.js';
import { toastSuccess, toastError } from '../../lib/toast.js';
import {
  validateEmail,
  validateFullName,
  validatePassword,
  validatePasswordConfirm,
  validateBirthDate,
} from '../../lib/validation.js';
import { formatDateShort, initials } from '../../lib/format.js';

type Tab = 'profile' | 'children' | 'security' | 'data';

interface ChildData {
  id: string;
  fullName: string;
  birthDate: string;
  age: number;
  city: string | null;
  school: string | null;
  grade: number | null;
  balance: number;
}

interface ProfileData {
  userId: string;
  phone: string;
  email: string | null;
  fullName: string;
  city: string | null;
  role: string;
  status: string;
  totpEnabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

interface SessionData {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}

export async function renderAppProfile(): Promise<void> {
  const root = h('div');
  const currentTab = getTabFromUrl();

  setRoot(appLayout({
    active: 'profile',
    title: 'Профиль',
    subtitle: 'Управление аккаунтом, детьми и безопасностью',
    content: root,
  }));

  mount(root, loader());

  try {
    const [profileRes, childrenRes] = await Promise.all([
      api.get<{ profile: ProfileData }>('/me/profile'),
      api.get<{ children: ChildData[] }>('/me/children'),
    ]);

    store.setState({ children: childrenRes.children });

    const tabsEl = pillsTabs([
      {
        key: 'profile',
        label: 'Профиль',
        active: currentTab === 'profile',
        onClick: () => navigateTab('profile'),
      },
      {
        key: 'children',
        label: 'Дети',
        active: currentTab === 'children',
        onClick: () => navigateTab('children'),
      },
      {
        key: 'security',
        label: 'Безопасность',
        active: currentTab === 'security',
        onClick: () => navigateTab('security'),
      },
      {
        key: 'data',
        label: 'Данные',
        active: currentTab === 'data',
        onClick: () => navigateTab('data'),
      },
    ]);

    const contentHost = h('div', { class: 'anim-slide-up delay-1' });

    const renderTab = (): void => {
      clear(contentHost);
      const tab = getTabFromUrl();
      if (tab === 'profile') contentHost.appendChild(renderProfileTab(profileRes.profile));
      else if (tab === 'children') contentHost.appendChild(renderChildrenTab(childrenRes.children));
      else if (tab === 'security') contentHost.appendChild(renderSecurityTab(profileRes.profile));
      else contentHost.appendChild(renderDataTab());
    };

    const content = h('div', { class: 'stack-lg' },
      h('div', { style: 'display: flex; justify-content: center;' }, tabsEl),
      contentHost
    );

    mount(root, content);
    renderTab();

    window.addEventListener('hashchange', () => renderTab());
  } catch (err) {
    mount(root, emptyState({
      illustration: 'error',
      title: 'Не удалось загрузить профиль',
      description: isApiError(err) ? err.message : 'Попробуйте позже',
      action: h('button', {
        class: 'btn',
        type: 'button',
        onclick: () => router.reload(),
      }, 'Обновить'),
    }));
  }
}

function getTabFromUrl(): Tab {
  const hash = window.location.hash;
  const qIdx = hash.indexOf('?');
  if (qIdx === -1) return 'profile';
  const params = new URLSearchParams(hash.slice(qIdx + 1));
  const tab = params.get('tab') as Tab | null;
  if (tab && ['profile', 'children', 'security', 'data'].includes(tab)) return tab;
  return 'profile';
}

function navigateTab(tab: Tab): void {
  router.navigate(`/app/profile?tab=${tab}`);
}

// ============================================================
// PROFILE TAB
// ============================================================

function renderProfileTab(profile: ProfileData): HTMLElement {
  const email = field({
    name: 'email',
    label: 'Email',
    type: 'email',
    value: profile.email ?? '',
    validate: validateEmail,
  });

  const fullName = field({
    name: 'fullName',
    label: 'ФИО',
    value: profile.fullName,
    required: true,
    validate: validateFullName,
  });

  const city = field({
    name: 'city',
    label: 'Город',
    value: profile.city ?? '',
    placeholder: 'Москва',
  });

  const f = form({
    fields: [fullName.root, email.root, city.root],
    submitLabel: 'Сохранить',
    onSubmit: async () => {
      if (!fullName.validate() || !email.validate()) return;

      try {
        const res = await api.patch<{ profile: ProfileData }>('/me/profile', {
          fullName: fullName.getValue(),
          email: email.getValue(),
          city: city.getValue(),
        });
        toastSuccess('Профиль обновлён');
        const s = store.getState();
        store.setState({
          user: s.user ? { ...s.user, email: res.profile.email } : null,
        });
      } catch (err) {
        if (isApiError(err)) {
          if (err.details && typeof err.details === 'object') {
            const details = err.details as { fields?: Record<string, string> };
            if (details.fields) {
              if (details.fields.email) email.setError(details.fields.email);
              if (details.fields.fullName) fullName.setError(details.fields.fullName);
            }
          }
          toastError(err.message);
        } else {
          toastError('Не удалось сохранить');
        }
      }
    },
  });

  return h('div', { class: 'stack-lg' },
    h('div', { class: 'profile-header' },
      h('div', { class: 'avatar avatar-xl' }, initials(profile.fullName || profile.phone)),
      h('div', { class: 'profile-info' },
        h('div', { class: 'profile-name' }, profile.fullName || 'Родитель'),
        h('div', { class: 'profile-contact' }, profile.phone),
        h('div', { class: 'profile-meta' },
          `Регистрация: ${formatDateShort(profile.createdAt)}`,
          profile.lastLoginAt
            ? ` · Последний вход: ${formatDateShort(profile.lastLoginAt)}`
            : ''
        )
      )
    ),

    h('div', { class: 'card card-pad-lg' },
      h('h3', { style: 'margin-bottom: var(--sp-5);' }, 'Личные данные'),
      f.root
    )
  );
}

// ============================================================
// CHILDREN TAB
// ============================================================

function renderChildrenTab(children: ChildData[]): HTMLElement {
  const addBtn = h('button', {
    class: 'btn',
    type: 'button',
    onclick: () => openChildModal(null, () => router.reload()),
  },
    icon('plus', { size: 18 }),
    'Добавить ребёнка'
  );

  if (children.length === 0) {
    return h('div', { class: 'stack' },
      emptyState({
        illustration: 'welcome',
        title: 'Пока нет детей',
        description: 'Добавьте ребёнка, чтобы он мог проходить тесты и копить баллы.',
        action: addBtn,
      })
    );
  }

  return h('div', { class: 'stack' },
    h('div', { class: 'row-between' },
      h('h3', null, 'Дети'),
      addBtn
    ),
    h('div', { class: 'grid grid-auto-280 stagger' },
      ...children.map((c) => renderChildCard(c))
    )
  );
}

function renderChildCard(c: ChildData): HTMLElement {
  return h('div', { class: 'card card-pad stagger-item' },
    h('div', { class: 'row gap-3 mb-4' },
      h('div', { class: 'avatar' }, initials(c.fullName)),
      h('div', { class: 'grow', style: 'min-width: 0;' },
        h('div', { class: 'fw-700 truncate' }, c.fullName),
        h('div', { class: 'text-xs text-muted mt-1' },
          c.grade ? `${c.grade} класс · ` : '',
          `${c.age} лет`
        )
      )
    ),

    h('hr', { class: 'divider', style: 'margin: var(--sp-3) 0;' }),

    h('div', { class: 'text-sm text-muted' },
      c.school ? h('div', null, c.school) : null,
      c.city ? h('div', { class: 'mt-1' }, c.city) : null
    ),

    h('div', { class: 'row-between mt-5' },
      h('span', { class: 'badge badge-primary' },
        icon('award', { size: 12, className: 'icon icon-sm' }),
        `${c.balance} балл.`
      ),
      h('div', { class: 'row gap-1' },
        h('button', {
          class: 'btn btn-ghost btn-icon btn-sm',
          type: 'button',
          title: 'Редактировать',
          onclick: () => openChildModal(c, () => router.reload()),
        }, icon('edit-2', { size: 16, className: 'icon icon-sm' })),
        h('button', {
          class: 'btn btn-ghost btn-icon btn-sm',
          type: 'button',
          title: 'Удалить',
          onclick: async () => {
            const ok = await confirmModal({
              title: 'Удалить ребёнка?',
              message: `Профиль «${c.fullName}» будет удалён. История останется в архиве.`,
              confirmLabel: 'Удалить',
              danger: true,
            });
            if (!ok) return;
            try {
              await api.delete(`/me/children/${c.id}`);
              toastSuccess('Ребёнок удалён');
              router.reload();
            } catch (err) {
              toastError(isApiError(err) ? err.message : 'Не удалось удалить');
            }
          },
        }, icon('trash-2', { size: 16, className: 'icon icon-sm' }))
      )
    )
  );
}

function openChildModal(child: ChildData | null, onSuccess: () => void): void {
  const isEdit = child !== null;

  const fullName = field({
    name: 'fullName',
    label: 'ФИО',
    value: child?.fullName ?? '',
    required: true,
    validate: validateFullName,
  });

  const birthDate = field({
    name: 'birthDate',
    label: 'Дата рождения',
    type: 'date',
    value: child?.birthDate ?? '',
    required: true,
    validate: validateBirthDate,
  });

  const city = field({
    name: 'city',
    label: 'Город',
    value: child?.city ?? '',
    placeholder: 'Москва',
  });

  const school = field({
    name: 'school',
    label: 'Школа',
    value: child?.school ?? '',
    placeholder: 'ГБОУ Школа №1234',
  });

  const grade = selectField({
    name: 'grade',
    label: 'Класс',
    value: child?.grade ? String(child.grade) : '',
    placeholder: 'Выберите класс',
    options: Array.from({ length: 11 }, (_, i) => ({
      value: String(i + 1),
      label: `${i + 1} класс`,
    })),
  });

  const f = form({
    fields: [fullName.root, birthDate.root, city.root, school.root, grade.root],
    submitLabel: isEdit ? 'Сохранить' : 'Добавить',
    onSubmit: async () => {
      if (!fullName.validate() || !birthDate.validate()) return;
      try {
        const payload = {
          fullName: fullName.getValue(),
          birthDate: birthDate.getValue(),
          city: city.getValue(),
          school: school.getValue(),
          grade: grade.getValue() ? Number(grade.getValue()) : undefined,
        };

        if (isEdit && child) {
          await api.patch(`/me/children/${child.id}`, payload);
          toastSuccess('Ребёнок обновлён');
        } else {
          await api.post('/me/children', payload);
          toastSuccess('Ребёнок добавлен');
        }
        close();
        onSuccess();
      } catch (err) {
        if (isApiError(err)) {
          if (err.details && typeof err.details === 'object') {
            const details = err.details as { fields?: Record<string, string> };
            if (details.fields) {
              if (details.fields.fullName) fullName.setError(details.fields.fullName);
              if (details.fields.birthDate) birthDate.setError(details.fields.birthDate);
            }
          }
          toastError(err.message);
        } else {
          toastError('Не удалось сохранить');
        }
      }
    },
  });

  const close = openModal({
    title: isEdit ? 'Редактировать ребёнка' : 'Добавить ребёнка',
    body: f.root,
    actions: [],
    size: 'md',
  });
}

// ============================================================
// SECURITY TAB
// ============================================================

function renderSecurityTab(profile: ProfileData): HTMLElement {
  const currentPassword = passwordField({
    name: 'currentPassword',
    label: 'Текущий пароль',
    required: true,
    autocomplete: 'current-password',
  });

  const newPassword = passwordField({
    name: 'newPassword',
    label: 'Новый пароль',
    required: true,
    autocomplete: 'new-password',
    validate: validatePassword,
    hint: 'Минимум 8 символов, латинские буквы и цифры',
  });

  const newPasswordConfirm = passwordField({
    name: 'newPasswordConfirm',
    label: 'Повторите новый пароль',
    required: true,
    autocomplete: 'new-password',
    validate: (v) => validatePasswordConfirm(newPassword.getValue(), v),
  });

  const passwordForm = form({
    fields: [currentPassword.root, newPassword.root, newPasswordConfirm.root],
    submitLabel: 'Изменить пароль',
    onSubmit: async () => {
      const valid =
        currentPassword.validate() &&
        newPassword.validate() &&
        newPasswordConfirm.validate();
      if (!valid) return;

      try {
        await api.post('/auth/change-password', {
          currentPassword: currentPassword.getValue(),
          newPassword: newPassword.getValue(),
          newPasswordConfirm: newPasswordConfirm.getValue(),
        });
        toastSuccess('Пароль изменён, войдите заново');
        store.reset();
        try {
          localStorage.removeItem('ulybka:currentChildId');
        } catch {
          // ignore
        }
        window.location.hash = '#/login';
        setTimeout(() => window.location.reload(), 300);
      } catch (err) {
        toastError(isApiError(err) ? err.message : 'Не удалось изменить пароль');
      }
    },
  });

  return h('div', { class: 'stack-lg' },
    h('div', { class: 'card card-pad-lg' },
      h('h3', null, 'Смена пароля'),
      h('p', { class: 'text-sm text-muted mt-2 mb-5' },
        'После смены пароля все устройства будут разлогинены.'
      ),
      passwordForm.root
    ),

    h('div', { class: 'card card-pad-lg' },
      h('h3', null, 'Двухфакторная аутентификация'),
      h('p', { class: 'text-sm text-muted mt-2 mb-5' },
        'Защитите аккаунт дополнительным кодом при входе.'
      ),
      h('div', { class: 'row-between row-wrap gap-3' },
        h('div', { class: 'row gap-3' },
          h('div', {
            class: 'feature-icon',
            style: `width: 48px; height: 48px; margin: 0; background: ${profile.totpEnabled ? 'var(--c-success-bg)' : 'var(--c-surface-3)'}; color: ${profile.totpEnabled ? 'var(--c-green-700)' : 'var(--c-text-muted)'};`,
          }, icon('shield', { size: 22 })),
          h('div', null,
            h('div', { class: 'fw-700' }, profile.totpEnabled ? 'Включена' : 'Выключена'),
            h('div', { class: 'text-xs text-muted mt-1' },
              profile.totpEnabled
                ? 'При входе запрашивается код из приложения'
                : 'Рекомендуем включить'
            )
          )
        ),
        h('button', {
          class: `btn ${profile.totpEnabled ? 'btn-danger' : ''}`,
          type: 'button',
          onclick: () => profile.totpEnabled
            ? openDisable2FAModal(() => router.reload())
            : openEnable2FAModal(() => router.reload()),
        }, profile.totpEnabled ? 'Отключить' : 'Включить')
      )
    ),

    renderSessionsCard(),

    h('div', { class: 'card card-pad-lg', style: 'border-color: var(--c-danger);' },
      h('h3', { style: 'color: var(--c-coral-700);' }, 'Выход из аккаунта'),
      h('p', { class: 'text-sm text-muted mt-2 mb-5' },
        'Вы можете выйти из аккаунта на этом устройстве. Данные сохранятся.'
      ),
      h('button', {
        class: 'btn btn-danger',
        type: 'button',
        onclick: () => handleLogout(),
      },
        icon('log-out', { size: 18 }),
        'Выйти из аккаунта'
      )
    )
  );
}

function renderSessionsCard(): HTMLElement {
  const host = h('div', { class: 'card card-pad-lg' },
    h('h3', null, 'Активные сессии'),
    h('p', { class: 'text-sm text-muted mt-2 mb-5' },
      'Устройства, с которых выполнен вход в аккаунт.'
    ),
    loader()
  );

  void (async () => {
    try {
      const res = await api.get<{ sessions: SessionData[] }>('/auth/sessions');

      const list = h('div', { class: 'stack-sm' });

      if (res.sessions.length === 0) {
        list.appendChild(
          h('div', { class: 'text-sm text-muted' }, 'Нет активных сессий.')
        );
      }

      for (const s of res.sessions) {
        list.appendChild(
          h('div', { class: 'row-between row-wrap gap-3 card card-pad' },
            h('div', { style: 'min-width: 0; flex: 1;' },
              h('div', { class: 'row gap-2 row-wrap' },
                h('div', { class: 'fw-600' }, shortUa(s.userAgent)),
                s.current
                  ? h('span', { class: 'badge badge-success' }, 'текущая')
                  : null
              ),
              h('div', { class: 'text-xs text-muted mt-1' },
                s.ip ?? 'IP неизвестен',
                ' · ',
                formatDateShort(s.createdAt)
              )
            ),
            !s.current
              ? h('button', {
                  class: 'btn btn-danger btn-sm',
                  type: 'button',
                  onclick: async () => {
                    const ok = await confirmModal({
                      title: 'Завершить сессию?',
                      message: 'Устройство будет разлогинено.',
                      confirmLabel: 'Завершить',
                      danger: true,
                    });
                    if (!ok) return;
                    try {
                      await api.delete(`/auth/sessions/${s.id}`);
                      toastSuccess('Сессия завершена');
                      router.reload();
                    } catch {
                      toastError('Не удалось завершить');
                    }
                  },
                }, 'Завершить')
              : null
          )
        );
      }

      mount(host,
        h('h3', null, 'Активные сессии'),
        h('p', { class: 'text-sm text-muted mt-2 mb-5' },
          'Устройства, с которых выполнен вход в аккаунт.'
        ),
        list,
        h('button', {
          class: 'btn btn-secondary btn-block mt-5',
          type: 'button',
          onclick: async () => {
            const ok = await confirmModal({
              title: 'Выйти со всех устройств?',
              message: 'Все сессии будут завершены, включая текущую.',
              confirmLabel: 'Выйти везде',
              danger: true,
            });
            if (!ok) return;
            try {
              await api.post('/auth/logout-all', {});
              toastSuccess('Все сессии завершены');
              store.reset();
              window.location.hash = '#/login';
              setTimeout(() => window.location.reload(), 300);
            } catch {
              toastError('Не удалось');
            }
          },
        }, 'Выйти со всех устройств')
      );
    } catch {
      mount(host,
        h('h3', null, 'Активные сессии'),
        h('div', { class: 'alert alert-danger mt-3' }, 'Не удалось загрузить сессии')
      );
    }
  })();

  return host;
}

function shortUa(ua: string | null): string {
  if (!ua) return 'Неизвестное устройство';
  if (ua.includes('Windows')) return 'Windows';
  if (ua.includes('Mac OS')) return 'macOS';
  if (ua.includes('Linux')) return 'Linux';
  if (ua.includes('Android')) return 'Android';
  if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS';
  return 'Устройство';
}

async function handleLogout(): Promise<void> {
  const ok = await confirmModal({
    title: 'Выйти из аккаунта?',
    message: 'Вы будете перенаправлены на страницу входа.',
    confirmLabel: 'Выйти',
    danger: true,
  });

  if (!ok) return;

  try {
    await api.post('/auth/logout', {});
  } catch (err) {
    if (isApiError(err) && err.status !== 401) {
      // eslint-disable-next-line no-console
      console.warn('logout error', err);
    }
  }

  store.reset();
  try {
    localStorage.removeItem('ulybka:currentChildId');
  } catch {
    // ignore
  }

  toastSuccess('Вы вышли из аккаунта');
  window.location.hash = '#/login';
  setTimeout(() => window.location.reload(), 300);
}

function openEnable2FAModal(onSuccess: () => void): void {
  const content = h('div', { class: 'stack' }, loader('Готовим секрет...'));

  const close = openModal({
    title: 'Включение 2FA',
    body: content,
    actions: [],
    size: 'md',
  });

  void (async () => {
    try {
      const res = await api.post<{ secret: string; uri: string }>('/auth/2fa/setup');

      const code = field({
        name: 'totp',
        label: 'Код из приложения',
        required: true,
        placeholder: '000000',
        inputMode: 'numeric',
        maxLength: 6,
      });

      const f = form({
        fields: [
          h('p', { class: 'text-sm text-muted' },
            'Откройте Google Authenticator, Authy или 1Password и добавьте секрет вручную:'
          ),
          h('div', {
            class: 'code-display',
            style: 'font-size: 16px; letter-spacing: 0.06em; word-break: break-all;',
          }, res.secret),
          h('p', { class: 'text-xs text-muted' },
            'Или отсканируйте QR-код из приложения по ссылке ниже.'
          ),
          h('a', { href: res.uri, class: 'text-sm break-all' }, res.uri),
          h('hr', { class: 'divider' }),
          code.root,
        ],
        submitLabel: 'Включить',
        onSubmit: async () => {
          if (!code.validate()) return;
          try {
            const enableRes = await api.post<{ recoveryCodes: string[] }>(
              '/auth/2fa/enable',
              { secret: res.secret, code: code.getValue() }
            );

            clear(content);
            content.appendChild(
              h('div', { class: 'stack' },
                h('div', { class: 'alert alert-success' },
                  icon('check-circle', { size: 18, className: 'icon icon-sm alert-icon' }),
                  h('div', null,
                    h('div', { class: 'alert-title' }, '2FA включена'),
                    'Сохраните резервные коды в надёжном месте.'
                  )
                ),
                h('div', { class: 'card card-pad' },
                  h('div', { class: 'fw-700 mb-3' }, 'Резервные коды'),
                  h('div', { class: 'column-tight mono text-sm' },
                    ...enableRes.recoveryCodes.map((c) => h('div', null, c))
                  )
                ),
                h('button', {
                  class: 'btn btn-block mt-4',
                  type: 'button',
                  onclick: () => {
                    close();
                    onSuccess();
                  },
                }, 'Готово')
              )
            );
          } catch (err) {
            if (isApiError(err)) toastError(err.message);
            else toastError('Не удалось включить 2FA');
          }
        },
      });

      clear(content);
      content.appendChild(f.root);
    } catch (err) {
      clear(content);
      content.appendChild(
        h('div', { class: 'alert alert-danger' },
          isApiError(err) ? err.message : 'Не удалось получить секрет'
        )
      );
    }
  })();
}

function openDisable2FAModal(onSuccess: () => void): void {
  const password = passwordField({
    name: 'password',
    label: 'Текущий пароль',
    required: true,
  });

  const f = form({
    fields: [password.root],
    submitLabel: 'Отключить',
    onSubmit: async () => {
      if (!password.validate()) return;
      try {
        await api.post('/auth/2fa/disable', { password: password.getValue() });
        toastSuccess('2FA отключена');
        close();
        onSuccess();
      } catch (err) {
        if (isApiError(err)) toastError(err.message);
        else toastError('Не удалось отключить');
      }
    },
  });

  const close = openModal({
    title: 'Отключение 2FA',
    body: f.root,
    actions: [],
    size: 'sm',
  });
}

// ============================================================
// DATA TAB (152-ФЗ)
// ============================================================

function renderDataTab(): HTMLElement {
  return h('div', { class: 'stack-lg' },
    h('div', { class: 'card card-pad-lg' },
      h('h3', null, 'Экспорт данных'),
      h('p', { class: 'text-sm text-muted mt-2 mb-5' },
        'Скачайте все свои данные и данные детей в машиночитаемом формате. Право на экспорт — по 152-ФЗ.'
      ),
      h('button', {
        class: 'btn btn-secondary',
        type: 'button',
        onclick: async () => {
          try {
            const res = await fetch('/api/v1/me/export', { credentials: 'include' });
            if (!res.ok) {
              toastError('Не удалось скачать данные');
              return;
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `ulybka-export-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
            toastSuccess('Файл скачан');
          } catch {
            toastError('Не удалось скачать данные');
          }
        },
      },
        icon('download', { size: 18 }),
        'Скачать мои данные'
      )
    ),

    h('div', { class: 'card card-pad-lg', style: 'border-color: var(--c-danger);' },
      h('h3', { style: 'color: var(--c-coral-700);' }, 'Удаление аккаунта'),
      h('p', { class: 'text-sm text-muted mt-2 mb-5' },
        'Аккаунт будет обезличен, персональные данные удалены, доступ к кабинету закрыт. Действие необратимо.'
      ),
      h('button', {
        class: 'btn btn-danger',
        type: 'button',
        onclick: () => openDeleteModal(),
      },
        icon('trash-2', { size: 18 }),
        'Удалить аккаунт'
      )
    )
  );
}

function openDeleteModal(): void {
  const password = passwordField({
    name: 'password',
    label: 'Пароль',
    required: true,
  });

  const confirmField = field({
    name: 'confirm',
    label: 'Введите слово УДАЛИТЬ',
    required: true,
    placeholder: 'УДАЛИТЬ',
  });

  const reasonField = field({
    name: 'reason',
    label: 'Причина (необязательно)',
  });

  const f = form({
    fields: [password.root, confirmField.root, reasonField.root],
    submitLabel: 'Удалить аккаунт',
    onSubmit: async () => {
      if (!password.validate() || !confirmField.validate()) return;

      if (confirmField.getValue() !== 'УДАЛИТЬ') {
        confirmField.setError('Введите слово УДАЛИТЬ');
        return;
      }

      try {
        await api.post('/me/delete', {
          password: password.getValue(),
          confirm: 'УДАЛИТЬ',
          reason: reasonField.getValue() || undefined,
        });
        toastSuccess('Аккаунт удалён');
        store.reset();
        try {
          localStorage.removeItem('ulybka:currentChildId');
        } catch {
          // ignore
        }
        window.location.hash = '#/';
        setTimeout(() => window.location.reload(), 300);
      } catch (err) {
        if (isApiError(err)) toastError(err.message);
        else toastError('Не удалось удалить аккаунт');
      }
    },
  });

  openModal({
    title: 'Удаление аккаунта',
    body: h('div', { class: 'stack' },
      h('div', { class: 'alert alert-danger' },
        icon('alert-triangle', { size: 18, className: 'icon icon-sm alert-icon' }),
        h('div', null,
          h('div', { class: 'alert-title' }, 'Это действие необратимо'),
          'Все персональные данные будут удалены. Восстановление невозможно.'
        )
      ),
      f.root
    ),
    actions: [],
    size: 'md',
  });
}