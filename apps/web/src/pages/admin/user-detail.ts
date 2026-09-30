// ============================================================
// pages/admin/user-detail.ts — отдельная страница пользователя
// + смена собственного пароля (только superadmin, только для себя)
// ============================================================

import { h, mount } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { api, isApiError } from '../../lib/api.js';
import { router } from '../../lib/router.js';
import { adminLayout, setRoot, backLink } from '../../components/layout.js';
import { emptyState, loader, statusBadge } from '../../components/ui.js';
import { passwordField, form } from '../../components/form.js';
import { toastSuccess, toastError } from '../../lib/toast.js';
import { formatDateShort, formatMoney, formatPhone, initials } from '../../lib/format.js';
import { store } from '../../lib/store.js';
import { validatePassword, validatePasswordConfirm } from '../../lib/validation.js';

interface AdminUserDetail {
  id: string;
  role: string;
  status: string;
  phone: string;
  phoneMasked: string;
  email: string | null;
  fullName: string | null;
  city: string | null;
  childrenCount: number;
  attemptsCount: number;
  subscriptionStatus: string | null;
  fraudDisabled: boolean;
  partnerId: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  totpEnabled: boolean;
  children: Array<{
    id: string;
    fullName: string;
    age: number;
    grade: number | null;
    balance: number;
    attemptsCount: number;
    flaggedCount: number;
  }>;
  recentAttempts: Array<{
    id: string;
    testTitle: string;
    status: string;
    scorePoints: number;
    percentCorrect: number;
    suspicionScore: number;
    finishedAt: string | null;
    startedAt: string;
  }>;
  recentPayments: Array<{
    id: string;
    amountRub: number;
    status: string;
    paidAt: string | null;
    createdAt: string;
  }>;
  partner: {
    id: string;
    slug: string;
    name: string;
    status: string;
    offersCount: number;
    redemptionsCount: number;
  } | null;
  totalPaidRub: number;
}

const ROLE_LABELS: Record<string, string> = {
  parent: 'Родитель',
  partner: 'Партнёр',
  manager: 'Менеджер',
  curator: 'Куратор',
  admin: 'Администратор',
  superadmin: 'Супер-админ',
};

export async function renderAdminUserDetail(ctx: {
  params: { id: string };
}): Promise<void> {
  const userId = ctx.params.id;

  const root = h('div');
  setRoot(
    adminLayout({
      active: 'users',
      title: 'Пользователь',
      content: root,
    })
  );
  mount(root, loader());

  try {
    const res = await api.get<{ user: AdminUserDetail }>(`/admin/users/${userId}`);
    const user = res.user;
    const currentUser = store.getState().user;
    const isSuperAdmin = currentUser?.role === 'superadmin';
    const isSelf = currentUser?.id === user.id;

    const pageHead = h('div', { class: 'page-head' },
      h('div', null,
        h('div', { class: 'anim-slide-up' }, backLink('Все пользователи', '#/admin/users')),
        h('h1', { class: 'page-title mt-3' }, user.fullName ?? 'Пользователь'),
        h('div', { class: 'page-subtitle' },
          `${ROLE_LABELS[user.role] ?? user.role} · ${formatPhone(user.phone)}`
        )
      ),
      h('div', { class: 'page-actions' },
        h('button', {
          class: 'btn btn-secondary',
          type: 'button',
          onclick: () => void refresh(),
        },
          icon('refresh-cw', { size: 16, className: 'icon icon-sm' }),
          'Обновить'
        )
      )
    );

    const content = h('div', { class: 'stack-lg' },
      pageHead,

      h('div', { class: 'card card-pad-lg anim-slide-up' },
        h('div', { class: 'user-summary' },
          h('div', { class: 'avatar avatar-lg' }, initials(user.fullName ?? user.phone)),
          h('div', { class: 'user-summary-info' },
            h('div', { class: 'user-summary-name' }, user.fullName ?? '—'),
            h('div', { class: 'user-summary-contact' }, formatPhone(user.phone)),
            user.email
              ? h('div', { class: 'user-summary-contact' }, user.email)
              : null,
            h('div', { class: 'row gap-2 row-wrap mt-2' },
              roleBadge(user.role),
              statusBadge(user.status),
              user.fraudDisabled
                ? h('span', { class: 'badge badge-danger' },
                    icon('shield-off', { size: 12, className: 'icon icon-sm' }),
                    'Фрод отключён'
                  )
                : null,
              isSelf
                ? h('span', { class: 'badge badge-primary' }, 'Это вы')
                : null
            )
          )
        ),
        h('div', { class: 'info-grid mt-5' },
          infoBlock('Дети', String(user.childrenCount)),
          infoBlock('Попытки', String(user.attemptsCount)),
          infoBlock('Подписка',
            user.subscriptionStatus ? statusBadge(user.subscriptionStatus) : '—'
          ),
          infoBlock('2FA', user.totpEnabled ? 'Включена' : 'Выключена'),
          infoBlock('Регистрация', formatDateShort(user.createdAt)),
          infoBlock(
            'Последний вход',
            user.lastLoginAt ? formatDateShort(user.lastLoginAt) : '—'
          ),
          user.totalPaidRub > 0
            ? infoBlock('Оплачено', formatMoney(user.totalPaidRub))
            : null
        )
      ),

      // -------- Смена пароля: только superadmin и только для себя --------
      isSuperAdmin && isSelf
        ? renderPasswordChangeCard()
        : null,

      user.partner
        ? h('div', { class: 'card card-pad anim-slide-up' },
            h('h4', { class: 'mb-3' }, 'Партнёр'),
            h('div', { class: 'info-grid' },
              infoBlock('Название', user.partner.name),
              infoBlock('Slug', h('span', { class: 'mono text-xs' }, user.partner.slug)),
              infoBlock('Статус', statusBadge(user.partner.status)),
              infoBlock('Офферов', String(user.partner.offersCount)),
              infoBlock('Обменов', String(user.partner.redemptionsCount))
            )
          )
        : null,

      user.children.length > 0
        ? h('div', { class: 'anim-slide-up' },
            h('h3', { class: 'mb-3' }, 'Дети'),
            h('div', { class: 'stack-sm' },
              ...user.children.map((c) => renderChildRow(c, refresh))
            )
          )
        : null,

      user.recentAttempts.length > 0
        ? h('div', { class: 'anim-slide-up' },
            h('h3', { class: 'mb-3' }, 'Последние попытки'),
            h('div', { class: 'card' },
              h('div', { class: 'table-wrap', style: 'border: 0;' },
                h('table', { class: 'table table-compact' },
                  h('thead', null,
                    h('tr', null,
                      h('th', null, 'Тест'),
                      h('th', null, 'Статус'),
                      h('th', null, 'Результат'),
                      h('th', null, 'Баллы'),
                      h('th', null, 'Suspicion'),
                      h('th', null, 'Завершён')
                    )
                  ),
                  h('tbody', null,
                    ...user.recentAttempts.map((a) =>
                      h('tr', null,
                        h('td', { class: 'text-sm truncate', style: 'max-width: 240px;' }, a.testTitle),
                        h('td', null, statusBadge(a.status)),
                        h('td', { class: 'text-sm' }, `${Math.round(a.percentCorrect)}%`),
                        h('td', { class: 'text-sm' }, `+${a.scorePoints}`),
                        h('td', { class: 'text-sm' },
                          h('span', {
                            class: `badge ${
                              a.suspicionScore >= 70 ? 'badge-danger' :
                              a.suspicionScore >= 30 ? 'badge-warning' :
                              'badge'
                            }`,
                          }, String(a.suspicionScore))
                        ),
                        h('td', { class: 'text-xs text-muted nowrap' },
                          a.finishedAt ? formatDateShort(a.finishedAt) : '—'
                        )
                      )
                    )
                  )
                )
              )
            )
          )
        : null,

      user.recentPayments.length > 0
        ? h('div', { class: 'anim-slide-up' },
            h('h3', { class: 'mb-3' }, 'Последние платежи'),
            h('div', { class: 'card' },
              h('div', { class: 'table-wrap', style: 'border: 0;' },
                h('table', { class: 'table table-compact' },
                  h('thead', null,
                    h('tr', null,
                      h('th', null, 'Дата'),
                      h('th', null, 'Сумма'),
                      h('th', null, 'Статус')
                    )
                  ),
                  h('tbody', null,
                    ...user.recentPayments.map((p) =>
                      h('tr', null,
                        h('td', { class: 'text-sm text-muted nowrap' },
                          formatDateShort(p.paidAt ?? p.createdAt)
                        ),
                        h('td', { class: 'fw-700 text-sm nowrap' }, formatMoney(p.amountRub)),
                        h('td', null, statusBadge(p.status))
                      )
                    )
                  )
                )
              )
            )
          )
        : null,

      isSuperAdmin && user.role === 'parent'
        ? renderFraudBlock(user, refresh)
        : null
    );

    mount(root, content);
  } catch (err) {
    mount(root, emptyState({
      illustration: 'error',
      title: 'Не удалось загрузить пользователя',
      description: isApiError(err) ? err.message : 'Попробуйте позже',
      action: h('a', { class: 'btn', href: '#/admin/users' }, 'К списку'),
    }));
  }

  async function refresh(): Promise<void> {
    router.navigate(`/admin/users/${userId}`);
    router.reload();
  }
}

// ============================================================
// Блок «Смена пароля» — только superadmin и только для себя
// ============================================================

function renderPasswordChangeCard(): HTMLElement {
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

  const f = form({
    fields: [
      h('div', { class: 'alert alert-warning' },
        icon('alert-triangle', { size: 18, className: 'icon icon-sm alert-icon' }),
        h('div', null,
          h('div', { class: 'alert-title' }, 'Внимание'),
          'После смены пароля все ваши активные сессии, включая текущую, будут завершены. ' +
          'Вам потребуется войти заново под новым паролем.'
        )
      ),
      currentPassword.root,
      newPassword.root,
      newPasswordConfirm.root,
    ],
    submitLabel: 'Сменить пароль',
    onSubmit: async () => {
      const valid =
        currentPassword.validate() &&
        newPassword.validate() &&
        newPasswordConfirm.validate();

      if (!valid) return;

      if (currentPassword.getValue() === newPassword.getValue()) {
        newPassword.setError('Новый пароль должен отличаться от текущего');
        return;
      }

      try {
        await api.post<{ ok: true; message: string; relogin: boolean }>(
          `/admin/users/${store.getState().user?.id ?? ''}/password`,
          {
            currentPassword: currentPassword.getValue(),
            newPassword: newPassword.getValue(),
            newPasswordConfirm: newPasswordConfirm.getValue(),
          }
        );

        toastSuccess('Пароль изменён. Войдите заново.');

        // Сбрасываем локальное состояние и уводим на логин
        store.reset();
        try {
          localStorage.removeItem('ulybka:currentChildId');
        } catch {
          // ignore
        }
        window.location.hash = '#/login';
        setTimeout(() => window.location.reload(), 400);
      } catch (err) {
        if (isApiError(err)) {
          if (err.status === 422 && err.details && typeof err.details === 'object') {
            const details = err.details as { fields?: Record<string, string> };
            if (details.fields) {
              if (details.fields.currentPassword)
                currentPassword.setError(details.fields.currentPassword);
              if (details.fields.newPassword)
                newPassword.setError(details.fields.newPassword);
              if (details.fields.newPasswordConfirm)
                newPasswordConfirm.setError(details.fields.newPasswordConfirm);
            }
          }
          f.setSubmitError(err.message);
          toastError(err.message);
        } else {
          f.setSubmitError('Не удалось изменить пароль');
        }
      }
    },
  });

  return h('div', {
    class: 'card card-pad-lg anim-slide-up',
    style: 'border-color: var(--c-primary);',
  },
    h('div', { class: 'row gap-3 mb-4', style: 'align-items: center;' },
      h('div', {
        class: 'feature-icon',
        style: 'margin: 0; width: 44px; height: 44px; flex: 0 0 auto;',
      }, icon('lock', { size: 22 })),
      h('div', null,
        h('h3', { style: 'margin: 0;' }, 'Сменить пароль'),
        h('div', { class: 'text-sm text-muted mt-1' },
          'Доступно только суперадмину для собственной учётной записи.'
        )
      )
    ),
    f.root
  );
}

// ============================================================
// Helpers
// ============================================================

function roleBadge(role: string): HTMLElement {
  const cls =
    role === 'superadmin' ? 'badge-danger' :
    role === 'admin' ? 'badge-warning' :
    role === 'partner' ? 'badge-accent' :
    role === 'curator' ? 'badge-primary' :
    role === 'manager' ? 'badge-info' :
    '';
  return h('span', { class: `badge ${cls}` }, ROLE_LABELS[role] ?? role);
}

function infoBlock(label: string, value: string | HTMLElement): HTMLElement {
  return h('div', { class: 'info-block' },
    h('div', { class: 'info-block-label' }, label),
    h('div', { class: 'info-block-value' }, value)
  );
}

function renderChildRow(
  c: AdminUserDetail['children'][number],
  onReload: () => void
): HTMLElement {
  const deltaInput = h('input', {
    class: 'input',
    type: 'number',
    placeholder: '+10 или -5',
    style: 'max-width: 120px;',
  }) as HTMLInputElement;

  const reasonInput = h('input', {
    class: 'input',
    placeholder: 'Причина',
    style: 'flex: 1; min-width: 120px;',
  }) as HTMLInputElement;

  const applyBtn = h('button', {
    class: 'btn btn-sm',
    type: 'button',
    onclick: async () => {
      const delta = parseInt(deltaInput.value, 10);
      const reason = reasonInput.value.trim();

      if (!delta || delta === 0) {
        toastError('Введите ненулевое значение');
        return;
      }
      if (reason.length < 3) {
        toastError('Причина минимум 3 символа');
        return;
      }

      applyBtn.disabled = true;
      try {
        const res = await api.post<{ ok: boolean; balanceAfter: number }>(
          `/admin/children/${c.id}/adjust-points`,
          { delta, reason }
        );
        toastSuccess(`Новый баланс: ${res.balanceAfter}`);
        deltaInput.value = '';
        reasonInput.value = '';
        onReload();
      } catch (err) {
        toastError(isApiError(err) ? err.message : 'Не удалось');
      } finally {
        applyBtn.disabled = false;
      }
    },
  }, 'Применить');

  return h('div', { class: 'card card-pad' },
    h('div', { class: 'row-between row-wrap gap-3' },
      h('div', { style: 'min-width: 0;' },
        h('div', { class: 'fw-700' }, c.fullName),
        h('div', { class: 'text-xs text-muted mt-1' },
          `${c.age} лет`,
          c.grade ? ` · ${c.grade} класс` : '',
          ` · ${c.attemptsCount} попыток`,
          c.flaggedCount > 0 ? ` · ${c.flaggedCount} флагов` : ''
        )
      ),
      h('div', { class: 'row gap-2 row-wrap', style: 'align-items: center;' },
        h('span', { class: 'badge badge-primary' }, `${c.balance} балл.`)
      )
    ),
    h('div', { class: 'row gap-2 row-wrap mt-3' },
      deltaInput,
      reasonInput,
      applyBtn
    )
  );
}

function renderFraudBlock(
  user: AdminUserDetail,
  onReload: () => void
): HTMLElement {
  const reasonInput = h('input', {
    class: 'input',
    placeholder: 'Причина отключения / включения (мин. 3 символа)',
  }) as HTMLInputElement;

  const toggleBtn = h('button', {
    class: `btn ${user.fraudDisabled ? 'btn-success' : 'btn-danger'}`,
    type: 'button',
    onclick: async () => {
      const reason = reasonInput.value.trim();
      if (reason.length < 3) {
        toastError('Введите причину');
        return;
      }

      toggleBtn.disabled = true;
      try {
        const nextDisabled = !user.fraudDisabled;
        await api.patch(`/admin/users/${user.id}/fraud`, {
          disabled: nextDisabled,
          reason,
        });
        toastSuccess(nextDisabled ? 'Антифрод отключён' : 'Антифрод включён');
        reasonInput.value = '';
        onReload();
      } catch (err) {
        toastError(isApiError(err) ? err.message : 'Не удалось');
      } finally {
        toggleBtn.disabled = false;
      }
    },
  },
    icon(user.fraudDisabled ? 'shield' : 'shield-off', { size: 16, className: 'icon icon-sm' }),
    user.fraudDisabled ? 'Включить антифрод' : 'Отключить антифрод'
  );

  return h('div', {
    class: `card card-pad ${user.fraudDisabled ? 'is-danger' : 'is-warning'}`,
    style: user.fraudDisabled ? 'border-color: var(--c-danger);' : '',
  },
    h('div', { class: 'row gap-3', style: 'align-items: flex-start;' },
      h('div', {
        class: 'feature-icon',
        style: `margin: 0; width: 44px; height: 44px; flex: 0 0 auto; background: ${user.fraudDisabled ? 'var(--c-danger-bg)' : 'var(--c-warning-bg)'}; color: ${user.fraudDisabled ? 'var(--c-coral-700)' : 'var(--c-peach-700)'};`,
      }, icon(user.fraudDisabled ? 'shield-off' : 'shield', { size: 22 })),
      h('div', { style: 'min-width: 0; flex: 1;' },
        h('div', { class: 'fw-700' },
          user.fraudDisabled
            ? 'Антифрод отключён для этого родителя'
            : 'Антифрод включён'
        ),
        h('div', { class: 'text-sm text-muted mt-1' },
          user.fraudDisabled
            ? 'Все попытки детей этого родителя не проходят проверку антифрода. Действие только для superadmin.'
            : 'Попытки детей проверяются как обычно. Отключение доступно только superadmin.'
        )
      )
    ),
    h('div', { class: 'row gap-2 row-wrap mt-4' },
      reasonInput,
      toggleBtn
    )
  );
}