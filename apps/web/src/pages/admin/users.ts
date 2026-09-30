// ============================================================
// pages/admin/users.ts — управление пользователями
// + экспорт CSV.
// ============================================================

import { h, mount } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { api, isApiError } from '../../lib/api.js';
import { router } from '../../lib/router.js';
import { adminLayout, setRoot } from '../../components/layout.js';
import { emptyState, loader, pagination, statusBadge } from '../../components/ui.js';
import { openModal } from '../../lib/modal.js';
import { toastSuccess, toastError, toastWarn } from '../../lib/toast.js';
import { formatDateShort, formatPhone, initials } from '../../lib/format.js';
import { store } from '../../lib/store.js';

interface AdminUser {
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
}

interface PartnerShort {
  id: string;
  slug: string;
  name: string;
  status: string;
}

interface CreateUserResult {
  user: AdminUser;
  temporaryPassword: string;
}

const PAGE_SIZE = 50;

const ROLE_LABELS: Record<string, string> = {
  parent: 'Родитель',
  partner: 'Партнёр',
  manager: 'Менеджер',
  curator: 'Куратор',
  admin: 'Администратор',
  superadmin: 'Супер-админ',
};

export async function renderAdminUsers(): Promise<void> {
  const params = getQueryParams();
  const page = parseInt(params.get('page') ?? '1', 10) || 1;
  const role = params.get('role') ?? '';
  const status = params.get('status') ?? '';
  const q = params.get('q') ?? '';

  const root = h('div');
  const currentUser = store.getState().user;
  const canCreate = currentUser?.role === 'admin' || currentUser?.role === 'superadmin';

  setRoot(adminLayout({
    active: 'users',
    title: 'Пользователи',
    actions: [
      h('button', {
        class: 'btn btn-secondary',
        type: 'button',
        onclick: () => downloadCsv('/api/v1/admin/users/export?limit=50000', `users-${new Date().toISOString().slice(0, 10)}.csv`),
      },
        icon('download', { size: 18 }),
        'Экспорт'
      ),
      canCreate
        ? h('button', {
            class: 'btn',
            type: 'button',
            onclick: () => void openCreateUserModal(() => router.reload()),
          },
            icon('user-plus', { size: 18 }),
            'Создать пользователя'
          )
        : null,
    ].filter((x): x is HTMLElement => x !== null),
    content: root,
  }));
  mount(root, loader());

  try {
    const query = new URLSearchParams();
    query.set('limit', String(PAGE_SIZE));
    query.set('offset', String((page - 1) * PAGE_SIZE));
    if (role) query.set('role', role);
    if (status) query.set('status', status);
    if (q) query.set('q', q);

    const res = await api.get<{ items: AdminUser[]; total: number }>(
      `/admin/users?${query.toString()}`
    );

    const totalPages = Math.max(1, Math.ceil(res.total / PAGE_SIZE));

    const searchInput = h('input', {
      class: 'input',
      type: 'search',
      placeholder: 'Поиск по email или телефону...',
      value: q,
      style: 'max-width: 320px;',
      onkeydown: (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
          navigateWithFilters({ q: searchInput.value, page: 1 });
        }
      },
    }) as HTMLInputElement;

    const filterBar = h('div', { class: 'row gap-3 row-wrap anim-slide-up' },
      searchInput,
      roleSelect(role),
      statusSelect(status),
      h('button', {
        class: 'btn btn-secondary btn-sm',
        type: 'button',
        onclick: () => navigateWithFilters({ q: '', role: '', status: '', page: 1 }),
      }, 'Сбросить')
    );

    const table = h('div', { class: 'card anim-slide-up delay-1' },
      h('div', { class: 'table-wrap', style: 'border: 0; border-radius: var(--r-lg);' },
        h('table', { class: 'table' },
          h('thead', null,
            h('tr', null,
              h('th', null, 'Пользователь'),
              h('th', null, 'Роль'),
              h('th', null, 'Статус'),
              h('th', null, 'Дети'),
              h('th', null, 'Попытки'),
              h('th', null, 'Подписка'),
              h('th', null, 'Регистрация'),
              h('th', null, '')
            )
          ),
          h('tbody', null,
            ...res.items.map((u) => renderRow(u))
          )
        )
      )
    );

    const pager = res.total > PAGE_SIZE
      ? pagination({
          page,
          totalPages,
          onChange: (p) => navigateWithFilters({ page: p }),
        })
      : null;

    mount(root,
      h('div', { class: 'stack-lg' },
        filterBar,
        h('div', { class: 'text-sm text-muted' }, `Найдено: ${res.total}`),
        res.items.length === 0
          ? emptyState({
              illustration: 'search-empty',
              title: 'Пользователи не найдены',
              description: 'Попробуйте изменить фильтры или запрос.',
            })
          : table,
        pager
      )
    );
  } catch (err) {
    mount(root, emptyState({
      illustration: 'error',
      title: 'Не удалось загрузить пользователей',
      description: isApiError(err) ? err.message : 'Попробуйте позже',
    }));
  }
}

function downloadCsv(url: string, filename: string): void {
  fetch(url, { credentials: 'include' })
    .then((res) => {
      if (!res.ok) throw new Error('Ошибка');
      return res.blob();
    })
    .then((blob) => {
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(objUrl);
      toastSuccess('Файл скачан');
    })
    .catch(() => toastError('Не удалось скачать'));
}

function roleSelect(current: string): HTMLElement {
  const select = h('select', {
    class: 'select',
    style: 'max-width: 180px;',
    onchange: () => navigateWithFilters({ role: select.value, page: 1 }),
  }) as HTMLSelectElement;

  for (const o of [
    { value: '', label: 'Все роли' },
    { value: 'parent', label: 'Родители' },
    { value: 'partner', label: 'Партнёры' },
    { value: 'manager', label: 'Менеджеры' },
    { value: 'curator', label: 'Кураторы' },
    { value: 'admin', label: 'Администраторы' },
    { value: 'superadmin', label: 'Супер-админы' },
  ]) {
    select.appendChild(h('option', { value: o.value, selected: o.value === current }, o.label));
  }

  return select;
}

function statusSelect(current: string): HTMLElement {
  const select = h('select', {
    class: 'select',
    style: 'max-width: 180px;',
    onchange: () => navigateWithFilters({ status: select.value, page: 1 }),
  }) as HTMLSelectElement;

  for (const o of [
    { value: '', label: 'Все статусы' },
    { value: 'active', label: 'Активные' },
    { value: 'pending', label: 'Ожидают' },
    { value: 'blocked', label: 'Заблокированные' },
    { value: 'deleted', label: 'Удалённые' },
  ]) {
    select.appendChild(h('option', { value: o.value, selected: o.value === current }, o.label));
  }

  return select;
}

function renderRow(u: AdminUser): HTMLElement {
  const roleBadge = h('span', {
    class: `badge ${
      u.role === 'superadmin' ? 'badge-danger' :
      u.role === 'admin' ? 'badge-warning' :
      u.role === 'partner' ? 'badge-accent' :
      u.role === 'curator' ? 'badge-primary' :
      u.role === 'manager' ? 'badge-info' :
      ''
    }`,
  }, ROLE_LABELS[u.role] ?? u.role);

  const warnings: HTMLElement[] = [];
  if (u.fraudDisabled) {
    warnings.push(
      h('span', { class: 'badge badge-danger' },
        icon('shield-off', { size: 12, className: 'icon icon-sm' }),
        'Фрод отключён'
      )
    );
  }

  return h('tr', null,
    h('td', { 'data-label-role': 'title' },
      h('div', { class: 'row gap-3' },
        h('div', { class: 'avatar avatar-sm' }, initials(u.fullName ?? u.phone)),
        h('div', { style: 'min-width: 0;' },
          h('div', { class: 'row gap-2 row-wrap' },
            h('div', { class: 'fw-600 truncate', style: 'max-width: 220px;' }, u.fullName ?? '—'),
            ...warnings
          ),
          h('div', { class: 'text-xs text-muted' }, u.email ?? formatPhone(u.phone))
        )
      )
    ),
    h('td', { 'data-label': 'Роль' }, roleBadge),
    h('td', { 'data-label': 'Статус' }, statusBadge(u.status)),
    h('td', { 'data-label': 'Дети' }, String(u.childrenCount)),
    h('td', { 'data-label': 'Попытки' }, String(u.attemptsCount)),
    h('td', { 'data-label': 'Подписка' },
      u.subscriptionStatus
        ? statusBadge(u.subscriptionStatus)
        : h('span', { class: 'text-dim text-sm' }, '—')
    ),
    h('td', { 'data-label': 'Регистрация', class: 'text-sm text-muted nowrap' },
      formatDateShort(u.createdAt)
    ),
    h('td', { 'data-label-role': 'actions' },
      h('a', {
        class: 'btn btn-ghost btn-sm',
        href: `#/admin/users/${u.id}`,
      }, 'Открыть')
    )
  );
}

async function openCreateUserModal(onSuccess: () => void): Promise<void> {
  const currentUser = store.getState().user;
  if (!currentUser) {
    toastError('Требуется авторизация');
    return;
  }

  const content = h('div', { class: 'stack' }, loader());
  let saveHandler: (() => Promise<boolean>) | null = null;

  const close = openModal({
    title: 'Создать пользователя',
    body: content,
    size: 'md',
    actions: [
      { label: 'Отмена', variant: 'secondary', onClick: () => true },
      {
        label: 'Создать',
        variant: 'primary',
        closeOnClick: false,
        onClick: async () => {
          if (!saveHandler) {
            toastError('Форма ещё не готова');
            return false;
          }
          const ok = await saveHandler();
          if (ok) close();
          return false;
        },
      },
    ],
  });

  try {
    const [rolesRes, partnersRes] = await Promise.all([
      api.get<{ roles: string[] }>('/admin/creatable-roles'),
      api
        .get<{ items: PartnerShort[] }>('/partners/admin?limit=200')
        .catch(() => ({ items: [] as PartnerShort[] })),
    ]);

    const creatableRoles = rolesRes.roles;
    const partnersList = partnersRes.items;

    if (creatableRoles.length === 0) {
      mount(content, h('div', { class: 'alert alert-warning' },
        'У вашей роли нет прав на создание пользователей.'
      ));
      return;
    }

    const roleSelect = h('select', { class: 'select' }) as HTMLSelectElement;
    for (const r of creatableRoles) {
      roleSelect.appendChild(h('option', { value: r }, ROLE_LABELS[r] ?? r));
    }

    const phoneInput = h('input', {
      class: 'input',
      type: 'tel',
      placeholder: '+7 (___) ___-__-__',
    }) as HTMLInputElement;

    const emailInput = h('input', {
      class: 'input',
      type: 'email',
      placeholder: 'mail@example.com',
    }) as HTMLInputElement;

    const fullNameInput = h('input', {
      class: 'input',
      placeholder: 'Иванова Мария Петровна',
    }) as HTMLInputElement;

    const cityInput = h('input', {
      class: 'input',
      placeholder: 'Москва',
    }) as HTMLInputElement;

    const partnerSelect = h('select', { class: 'select' }) as HTMLSelectElement;
    partnerSelect.appendChild(h('option', { value: '' }, '— выберите партнёра —'));
    for (const p of partnersList) {
      partnerSelect.appendChild(h('option', { value: p.id }, `${p.name} (#${p.slug})`));
    }

    const parentFields = h('div', { class: 'stack' },
      h('div', { class: 'field' },
        h('label', { class: 'field-label' }, 'ФИО родителя'),
        fullNameInput
      ),
      h('div', { class: 'field' },
        h('label', { class: 'field-label' }, 'Город'),
        cityInput
      )
    );

    const partnerFields = h('div', { class: 'stack' },
      h('div', { class: 'field' },
        h('label', { class: 'field-label' }, 'Партнёр ', h('span', { class: 'req' }, '*')),
        partnerSelect,
        h('div', { class: 'field-hint' }, 'Пользователь будет видеть офферы этого партнёра')
      )
    );

    const updateRoleFields = (): void => {
      const r = roleSelect.value;
      parentFields.classList.toggle('hide', r !== 'parent');
      partnerFields.classList.toggle('hide', r !== 'partner');
    };

    roleSelect.addEventListener('change', updateRoleFields);

    mount(content,
      h('div', { class: 'stack' },
        h('div', { class: 'field' },
          h('label', { class: 'field-label' }, 'Роль ', h('span', { class: 'req' }, '*')),
          roleSelect
        ),
        h('div', { class: 'field' },
          h('label', { class: 'field-label' }, 'Телефон ', h('span', { class: 'req' }, '*')),
          phoneInput
        ),
        h('div', { class: 'field' },
          h('label', { class: 'field-label' }, 'Email ', h('span', { class: 'req' }, '*')),
          emailInput
        ),
        parentFields,
        partnerFields,
        h('div', { class: 'alert alert-info' },
          h('div', null,
            h('div', { class: 'alert-title' }, 'Временный пароль'),
            'Система сгенерирует временный пароль и покажет его один раз. Пользователь сменит его при первом входе.'
          )
        )
      )
    );

    updateRoleFields();

    saveHandler = async (): Promise<boolean> => {
      const role = roleSelect.value;
      if (!role) { toastError('Выберите роль'); return false; }
      if (!phoneInput.value.trim()) { toastError('Введите телефон'); return false; }
      if (!emailInput.value.trim()) { toastError('Введите email'); return false; }
      if (role === 'partner' && !partnerSelect.value) {
        toastError('Выберите партнёра');
        return false;
      }

      try {
        const payload: Record<string, unknown> = {
          role,
          phone: phoneInput.value.trim(),
          email: emailInput.value.trim().toLowerCase(),
        };

        if (role === 'parent') {
          if (fullNameInput.value.trim()) payload.fullName = fullNameInput.value.trim();
          if (cityInput.value.trim()) payload.city = cityInput.value.trim();
        }
        if (role === 'partner') {
          payload.partnerId = partnerSelect.value;
        }

        const res = await api.post<CreateUserResult>('/admin/users', payload);

        toastSuccess('Пользователь создан');
        showTemporaryPasswordModal(res, onSuccess);
        return true;
      } catch (err) {
        toastError(isApiError(err) ? err.message : 'Не удалось создать пользователя');
        return false;
      }
    };
  } catch (err) {
    mount(content, h('div', { class: 'alert alert-danger' },
      isApiError(err) ? err.message : 'Не удалось открыть форму'
    ));
  }
}

function showTemporaryPasswordModal(
  res: CreateUserResult,
  onSuccess: () => void
): void {
  let copied = false;
  let done = false;

  const finish = (): void => {
    if (done) return;
    done = true;
    onSuccess();
  };

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(res.temporaryPassword);
      copied = true;
      toastSuccess('Пароль скопирован');
    } catch {
      toastError('Не удалось скопировать');
    }
  };

  void copy();

  openModal({
    title: 'Пользователь создан',
    body: h('div', { class: 'stack' },
      h('div', { class: 'alert alert-success' },
        icon('check-circle', { size: 18, className: 'icon icon-sm alert-icon' }),
        h('div', null,
          h('div', { class: 'alert-title' },
            `${ROLE_LABELS[res.user.role] ?? res.user.role} создан`
          ),
          `${res.user.email ?? res.user.phone}`
        )
      ),
      h('div', { class: 'field' },
        h('label', { class: 'field-label' }, 'Временный пароль'),
        h('div', { class: 'code-display' }, res.temporaryPassword),
        h('div', { class: 'field-hint' },
          'Сохраните пароль и передайте пользователю. Он сменит его при первом входе.'
        )
      ),
      h('div', { class: 'row gap-2' },
        h('button', {
          class: 'btn btn-secondary',
          type: 'button',
          onclick: () => void copy(),
        },
          icon('copy', { size: 16, className: 'icon icon-sm' }),
          'Скопировать пароль'
        )
      )
    ),
    size: 'md',
    actions: [
      {
        label: 'Готово',
        variant: 'primary',
        onClick: () => {
          finish();
          return true;
        },
      },
    ],
    onClose: () => {
      if (!done) {
        if (!copied) {
          toastWarn('Пароль показан один раз. Сохраните его.');
        }
        finish();
      }
    },
  });
}

function getQueryParams(): URLSearchParams {
  const hash = window.location.hash;
  const qIdx = hash.indexOf('?');
  if (qIdx === -1) return new URLSearchParams();
  return new URLSearchParams(hash.slice(qIdx + 1));
}

function navigateWithFilters(patch: Record<string, string | number>): void {
  const current = getQueryParams();
  const next = new URLSearchParams(current);
  for (const [k, v] of Object.entries(patch)) {
    if (v === '' || v === undefined || v === null) next.delete(k);
    else next.set(k, String(v));
  }
  const qs = next.toString();
  router.navigate(qs ? `/admin/users?${qs}` : '/admin/users');
}