// ============================================================
// components/child-switcher.ts — переключатель активного ребёнка
// Dropdown рендерится в <body> через position: fixed.
// Компактный вид на мобиле.
// ============================================================

import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { store } from '../lib/store.js';
import { api } from '../lib/api.js';
import { saveChildId } from '../lib/bootstrap.js';

// ============================================================
// Загрузка текущего ребёнка для страниц ЛК
// ============================================================

export interface CurrentChildContext {
  childId: string;
  children: Array<{
    id: string;
    fullName: string;
    grade: number | null;
    balance: number;
    birthDate: string;
    age: number;
  }>;
}

export async function loadCurrentChild(): Promise<
  CurrentChildContext | { redirect: string }
> {
  let state = store.getState();

  if (state.children.length === 0 && state.user) {
    try {
      const res = await api.get<{ children: CurrentChildContext['children'] }>('/me/children');
      state = store.getState();

      const saved = localStorage.getItem('ulybka:currentChildId');
      let currentChildId: string | null = state.currentChildId;

      if (!currentChildId && saved && res.children.some((c) => c.id === saved)) {
        currentChildId = saved;
      }
      if (!currentChildId || !res.children.some((c) => c.id === currentChildId)) {
        currentChildId = res.children[0]?.id ?? null;
      }

      store.setState({ children: res.children, currentChildId });
      if (currentChildId) saveChildId(currentChildId);

      state = store.getState();
    } catch {
      return { redirect: '/app/profile?tab=children' };
    }
  }

  if (state.children.length === 0) {
    return { redirect: '/app/profile?tab=children' };
  }

  const saved = localStorage.getItem('ulybka:currentChildId');
  let id: string | null = null;

  if (state.currentChildId && state.children.some((c) => c.id === state.currentChildId)) {
    id = state.currentChildId;
  } else if (saved && state.children.some((c) => c.id === saved)) {
    id = saved;
  } else {
    id = state.children[0]?.id ?? null;
  }

  if (!id) return { redirect: '/app/profile?tab=children' };

  if (id !== state.currentChildId) {
    store.setState({ currentChildId: id });
  }
  saveChildId(id);

  return { childId: id, children: state.children };
}

export function requireCurrentChild():
  | CurrentChildContext
  | { redirect: string } {
  const state = store.getState();
  if (state.children.length === 0) {
    return { redirect: '/app/profile?tab=children' };
  }
  const saved = localStorage.getItem('ulybka:currentChildId');
  let id: string | null = null;

  if (state.currentChildId && state.children.some((c) => c.id === state.currentChildId)) {
    id = state.currentChildId;
  } else if (saved && state.children.some((c) => c.id === saved)) {
    id = saved;
  } else {
    id = state.children[0]?.id ?? null;
  }

  if (!id) return { redirect: '/app/profile?tab=children' };

  if (id !== state.currentChildId) {
    store.setState({ currentChildId: id });
  }
  saveChildId(id);

  return { childId: id, children: state.children };
}

export function pickDefaultChild(children: Array<{ id: string }>): string | null {
  if (children.length === 0) return null;
  const saved = localStorage.getItem('ulybka:currentChildId');
  if (saved && children.some((c) => c.id === saved)) return saved;
  return children[0]!.id;
}

// ============================================================
// UI-компонент
// ============================================================

export interface ChildSwitcherOptions {
  children: Array<{
    id: string;
    fullName: string;
    grade: number | null;
    balance: number;
  }>;
  currentChildId: string | null;
  onChange: (childId: string) => void;
}

export function childSwitcher(options: ChildSwitcherOptions): HTMLElement | null {
  if (options.children.length === 0) return null;

  const current = options.children.find((c) => c.id === options.currentChildId);
  const label = current ? current.fullName.split(' ')[0] ?? current.fullName : 'Выбрать';

  const wrapper = h('div', { class: 'child-switcher' });

  const toggle = h('button', {
    class: 'btn btn-secondary btn-sm child-switcher-toggle',
    type: 'button',
    'aria-haspopup': 'true',
    'aria-expanded': 'false',
    onclick: (e: Event) => {
      e.stopPropagation();
      if (dropdownBackdrop) close();
      else open();
    },
  },
    icon('users', { size: 16, className: 'icon icon-sm' }),
    h('span', { class: 'child-switcher-toggle-label' }, label),
    current
      ? h('span', { class: 'badge badge-primary child-switcher-badge' },
          String(current.balance)
        )
      : null,
    icon('chevron-down', { size: 14, className: 'icon icon-sm' })
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

    dropdown = h('div', { class: 'child-switcher-dropdown' });

    for (const c of options.children) {
      const isActive = c.id === options.currentChildId;
      dropdown.appendChild(
        h('button', {
          class: `child-switcher-option ${isActive ? 'is-active' : ''}`,
          type: 'button',
          onclick: (e: Event) => {
            e.stopPropagation();
            close();
            saveChildId(c.id);
            store.setState({ currentChildId: c.id });
            options.onChange(c.id);
          },
        },
          h('div', { class: 'avatar avatar-sm' }, initialsFromName(c.fullName)),
          h('div', { class: 'grow', style: 'min-width: 0;' },
            h('div', { class: 'child-switcher-option-name truncate' }, c.fullName),
            h('div', { class: 'child-switcher-option-meta' },
              c.grade ? `${c.grade} класс · ` : '',
              `${c.balance} балл.`
            )
          ),
          isActive ? icon('check', { size: 16, className: 'icon icon-sm' }) : null
        )
      );
    }

    dropdown.appendChild(h('hr', { class: 'divider', style: 'margin: var(--sp-2) 0;' }));

    dropdown.appendChild(
      h('a', {
        class: 'child-switcher-option',
        href: '#/app/profile?tab=children',
        style: 'text-decoration: none; color: inherit;',
        onclick: () => close(),
      },
        h('div', { class: 'avatar avatar-sm', style: 'background: var(--c-surface-3); color: var(--c-text-muted);' },
          icon('plus', { size: 16, className: 'icon icon-sm' })
        ),
        h('div', { class: 'grow' },
          h('div', { class: 'child-switcher-option-name' }, 'Добавить ребёнка'),
          h('div', { class: 'child-switcher-option-meta' }, 'Открыть профиль')
        )
      )
    );

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
    const dropdownWidth = Math.min(320, window.innerWidth - 16);
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let left = rect.right - dropdownWidth;
    if (left < 8) left = Math.max(8, rect.left);
    if (left + dropdownWidth > viewportWidth - 8) {
      left = viewportWidth - dropdownWidth - 8;
    }

    // Если места снизу мало — открываем вверх
    const spaceBelow = viewportHeight - rect.bottom;
    const openUp = spaceBelow < 260 && rect.top > spaceBelow;

    dropdown.style.position = 'fixed';
    dropdown.style.left = `${left}px`;
    dropdown.style.right = 'auto';
    dropdown.style.width = `${dropdownWidth}px`;
    dropdown.style.maxHeight = `min(400px, ${Math.max(200, openUp ? rect.top - 16 : spaceBelow - 16)}px)`;

    if (openUp) {
      dropdown.style.top = 'auto';
      dropdown.style.bottom = `${viewportHeight - rect.top + 6}px`;
    } else {
      dropdown.style.bottom = 'auto';
      dropdown.style.top = `${rect.bottom + 6}px`;
    }
  }

  function close(): void {
    if (dropdown) {
      dropdown.remove();
      dropdown = null;
    }
    if (dropdownBackdrop) {
      dropdownBackdrop.remove();
      dropdownBackdrop = null;
    }
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

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}