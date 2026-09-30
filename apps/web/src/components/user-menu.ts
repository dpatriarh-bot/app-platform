// ============================================================
// components/user-menu.ts — выпадающее меню пользователя
// ============================================================

import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api, isApiError } from '../lib/api.js';
import { store } from '../lib/store.js';
import { toastSuccess } from '../lib/toast.js';
import { initials } from '../lib/format.js';
import { confirmModal } from '../lib/modal.js';

export interface UserMenuOptions {
  variant?: 'app' | 'admin' | 'partner';
}

export function userMenu(options: UserMenuOptions = {}): HTMLElement | null {
  const state = store.getState();
  const user = state.user;

  if (!user) return null;

  const isStaff = ['manager', 'curator', 'admin', 'superadmin'].includes(user.role);
  const isPartner = user.role === 'partner';
  const variant = options.variant ?? 'app';

  const wrapper = h('div', { class: 'user-menu-wrap' });

  const toggle = h('button', {
    class: 'user-menu',
    type: 'button',
    'aria-label': 'Меню пользователя',
    'aria-haspopup': 'true',
    'aria-expanded': 'false',
    onclick: (e: Event) => {
      e.stopPropagation();
      if (dropdownBackdrop) close();
      else open();
    },
  },
    h('span', { class: 'avatar avatar-sm' }, initials(user.phone)),
    h('span', { class: 'user-menu-name' }, user.email ?? user.phone),
    icon('chevron-down', { size: 14, className: 'icon icon-sm hide-mobile' })
  );

  wrapper.appendChild(toggle);

  let dropdown: HTMLElement | null = null;
  let dropdownBackdrop: HTMLElement | null = null;

  function open(): void {
    close();

    dropdownBackdrop = h('div', {
      class: 'child-switcher-backdrop',
      onclick: () => close(),
    });
    document.body.appendChild(dropdownBackdrop);

    dropdown = h('div', { class: 'user-menu-dropdown' });

    dropdown.appendChild(
      h('div', { class: 'user-menu-header' },
        h('div', { class: 'avatar avatar-lg' }, initials(user!.phone)),
        h('div', { class: 'user-menu-info' },
          h('div', { class: 'user-menu-info-name truncate' }, user!.email ?? user!.phone),
          h('div', { class: 'user-menu-info-role' }, roleLabel(user!.role))
        )
      )
    );

    dropdown.appendChild(h('hr', { class: 'divider', style: 'margin: var(--sp-2) 0;' }));

    const items: HTMLElement[] = [];

    if (variant === 'app') {
      items.push(
        menuLink('user', 'Профиль', '#/app/profile', close),
        menuLink('bell', 'Уведомления', '#/app/notifications', close),
        menuLink('credit-card', 'Подписка', '#/app/payments', close)
      );

      if (isStaff) {
        items.push(h('hr', { class: 'divider', style: 'margin: var(--sp-2) 0;' }));
        items.push(
          h('a', {
            class: 'user-menu-item',
            href: '#/admin',
            onclick: () => close(),
          },
            icon('settings', { size: 16, className: 'icon icon-sm' }),
            h('span', { class: 'grow' }, 'Админ-панель')
          )
        );
      }

      if (isPartner) {
        items.push(h('hr', { class: 'divider', style: 'margin: var(--sp-2) 0;' }));
        items.push(
          h('a', {
            class: 'user-menu-item',
            href: '#/partner',
            onclick: () => close(),
          },
            icon('briefcase', { size: 16, className: 'icon icon-sm' }),
            h('span', { class: 'grow' }, 'Кабинет партнёра')
          )
        );
      }
    } else if (variant === 'admin') {
      items.push(
        menuLink('home', 'Личный кабинет', '#/app', close),
        menuLink('users', 'Пользователи', '#/admin/users', close),
        menuLink('pie-chart', 'Дашборд', '#/admin', close)
      );
    } else if (variant === 'partner') {
      items.push(
        menuLink('pie-chart', 'Обзор', '#/partner', close),
        menuLink('gift', 'Офферы', '#/partner/offers', close),
        menuLink('award', 'Обмены', '#/partner/redemptions', close)
      );
    }

    items.push(h('hr', { class: 'divider', style: 'margin: var(--sp-2) 0;' }));

    items.push(
      h('button', {
        class: 'user-menu-item user-menu-item-danger',
        type: 'button',
        onclick: async () => {
          close();
          await handleLogout();
        },
      },
        icon('log-out', { size: 16, className: 'icon icon-sm' }),
        h('span', { class: 'grow' }, 'Выйти')
      )
    );

    for (const item of items) {
      dropdown.appendChild(item);
    }

    document.body.appendChild(dropdown);
    toggle.setAttribute('aria-expanded', 'true');
    positionDropdown();

    window.addEventListener('resize', positionDropdown);
    window.addEventListener('scroll', positionDropdown, true);
    window.addEventListener('hashchange', close);
    document.addEventListener('keydown', onKeydown);
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') close();
  }

  function positionDropdown(): void {
    if (!dropdown) return;
    const rect = toggle.getBoundingClientRect();
    const dropdownWidth = 280;
    const viewportWidth = window.innerWidth;

    let left = rect.right - dropdownWidth;
    if (left < 8) left = Math.max(8, rect.left);
    if (left + dropdownWidth > viewportWidth - 8) {
      left = viewportWidth - dropdownWidth - 8;
    }

    dropdown.style.position = 'fixed';
    dropdown.style.top = `${rect.bottom + 6}px`;
    dropdown.style.left = `${left}px`;
    dropdown.style.right = 'auto';
    dropdown.style.width = `${dropdownWidth}px`;
  }

  function close(): void {
    if (dropdown) { dropdown.remove(); dropdown = null; }
    if (dropdownBackdrop) { dropdownBackdrop.remove(); dropdownBackdrop = null; }
    toggle.setAttribute('aria-expanded', 'false');
    window.removeEventListener('resize', positionDropdown);
    window.removeEventListener('scroll', positionDropdown, true);
    window.removeEventListener('hashchange', close);
    document.removeEventListener('keydown', onKeydown);
  }

  const originalRemove = wrapper.remove.bind(wrapper);
  wrapper.remove = function () {
    close();
    originalRemove();
  };

  return wrapper;
}

async function handleLogout(): Promise<void> {
  const ok = await confirmModal({
    title: 'Выйти из аккаунта?',
    message: 'Вы будете перенаправлены на страницу входа.',
    confirmLabel: 'Выйти',
    cancelLabel: 'Отмена',
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
  try { localStorage.removeItem('ulybka:currentChildId'); } catch { /* ignore */ }

  toastSuccess('Вы вышли из аккаунта');
  window.location.hash = '#/login';
  setTimeout(() => window.location.reload(), 300);
}

function menuLink(iconName: string, label: string, href: string, onClick?: () => void): HTMLElement {
  return h('a', {
    class: 'user-menu-item',
    href,
    onclick: () => { onClick?.(); },
  },
    icon(iconName as never, { size: 16, className: 'icon icon-sm' }),
    h('span', { class: 'grow' }, label)
  );
}

function roleLabel(role: string): string {
  switch (role) {
    case 'parent': return 'Родитель';
    case 'partner': return 'Партнёр';
    case 'manager': return 'Менеджер';
    case 'curator': return 'Куратор';
    case 'admin': return 'Администратор';
    case 'superadmin': return 'Супер-администратор';
    default: return role;
  }
}