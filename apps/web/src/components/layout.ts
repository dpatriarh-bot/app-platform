// ============================================================
// components/layout.ts — каркасы public/app/admin/partner
// Логотип — inline SVG через brandMark().
// ============================================================

import { h } from '../lib/dom.js';
import { icon, type IconName } from '../lib/icons.js';
import { router } from '../lib/router.js';
import { store } from '../lib/store.js';
import { userMenu } from './user-menu.js';
import { brandMark } from './brand.js';

// ============================================================
// PUBLIC LAYOUT
// ============================================================

export interface PublicLayoutOptions {
  active?: 'home' | 'tariffs' | 'about' | 'contacts';
  content: HTMLElement;
}

interface PublicNavItem {
  key: 'home' | 'tariffs' | 'about' | 'contacts';
  label: string;
  href: string;
}

const PUBLIC_NAV: PublicNavItem[] = [
  { key: 'home', label: 'Главная', href: '#/' },
  { key: 'tariffs', label: 'Тарифы', href: '#/tariffs' },
  { key: 'about', label: 'О центре', href: '#/about' },
  { key: 'contacts', label: 'Контакты', href: '#/contacts' },
];

export function publicLayout(options: PublicLayoutOptions): HTMLElement {
  const state = store.getState();
  const user = state.user;

  const roleHome = (role: string): string => {
    switch (role) {
      case 'partner': return '/partner';
      case 'manager':
      case 'curator':
      case 'admin':
      case 'superadmin':
        return '/admin';
      default:
        return '/app';
    }
  };

  let closeTimer: number | null = null;

  const drawerNav = h('nav', { class: 'public-drawer-nav' },
    ...PUBLIC_NAV.map((item) =>
      h('a', {
        class: `public-drawer-link ${options.active === item.key ? 'is-active' : ''}`,
        href: item.href,
        onclick: () => closeDrawer(),
      },
        h('span', null, item.label),
        icon('chevron-right', { size: 16, className: 'icon icon-sm' })
      )
    ),
    !user
      ? h('a', {
          class: 'public-drawer-link',
          href: '#/login',
          onclick: () => closeDrawer(),
        },
          h('span', null, 'Войти'),
          icon('chevron-right', { size: 16, className: 'icon icon-sm' })
        )
      : null
  );

  const drawerBackdrop = h('div', {
    class: 'public-drawer-backdrop',
    onclick: () => closeDrawer(),
  });

  const drawer = h('div', { class: 'public-drawer', id: 'public-drawer' },
    drawerBackdrop,
    h('div', { class: 'public-drawer-panel' },
      h('div', { class: 'public-drawer-head' },
        brandMark({ size: 44, className: 'public-drawer-logo' }),
        h('div', null,
          h('div', { class: 'public-drawer-title' }, 'Улыбка ребёнка'),
          h('div', { class: 'public-drawer-subtitle' }, 'Образовательный центр')
        )
      ),
      drawerNav
    )
  );

  const openDrawer = (): void => {
    if (closeTimer !== null) { window.clearTimeout(closeTimer); closeTimer = null; }
    void drawer.offsetWidth;
    drawer.classList.add('is-open');
    document.body.classList.add('no-scroll');
    document.addEventListener('keydown', onKeydown);
  };

  const closeDrawer = (): void => {
    drawer.classList.remove('is-open');
    document.body.classList.remove('no-scroll');
    document.removeEventListener('keydown', onKeydown);
    if (closeTimer !== null) window.clearTimeout(closeTimer);
    closeTimer = window.setTimeout(() => { closeTimer = null; }, 320);
  };

  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') closeDrawer();
  };

  const burgerBtn = h('button', {
    class: 'public-burger',
    type: 'button',
    'aria-label': 'Меню',
    'aria-controls': 'public-drawer',
    onclick: openDrawer,
  }, icon('menu', { size: 22 }));

  const logoLink = h('a', { class: 'public-logo', href: '#/' },
    brandMark({ size: 40, className: 'public-logo-img' }),
    h('span', { class: 'public-logo-text' }, 'Улыбка ребёнка')
  );

  const desktopNav = h('nav', { class: 'public-nav' },
    ...PUBLIC_NAV.map((item) =>
      h('a', {
        href: item.href,
        class: options.active === item.key ? 'is-active' : '',
      }, item.label)
    )
  );

  const headerActions = user
    ? h('a', {
        class: 'btn btn-sm public-header-cta',
        href: `#${roleHome(user.role)}`,
      },
        icon('user', { size: 16, className: 'icon icon-sm' }),
        h('span', null, 'Личный кабинет')
      )
    : h('div', { class: 'public-header-actions' },
        h('a', { class: 'btn btn-ghost btn-sm public-header-login', href: '#/login' }, 'Войти'),
        h('a', { class: 'btn btn-sm public-header-cta', href: '#/register' }, 'Регистрация')
      );

  const header = h('header', { class: 'public-header' },
    h('div', { class: 'public-header-inner' },
      h('div', { class: 'public-header-left' }, burgerBtn, logoLink),
      h('div', { class: 'public-header-center' }, desktopNav),
      h('div', { class: 'public-header-right' }, headerActions)
    )
  );

  const footer = h('footer', { class: 'public-footer' },
    h('div', { class: 'public-footer-inner' },
      h('div', { class: 'public-footer-grid' },
        h('div', { class: 'public-footer-brand-col' },
          h('div', { class: 'public-footer-brand-row' },
            brandMark({ size: 36, className: 'public-footer-logo' }),
            h('div', { class: 'public-footer-brand' }, 'Улыбка ребёнка')
          ),
          h('p', { class: 'public-footer-tagline' },
            'Образовательный центр для школьников 1–11 классов. Тесты, трудокоины и подарки от партнёров. 80% выручки — на благотворительность.'
          )
        ),
        h('div', { class: 'public-footer-nav-col' },
          h('div', { class: 'public-footer-col-title' }, 'Разделы'),
          h('a', { href: '#/' }, 'Главная'),
          h('a', { href: '#/tariffs' }, 'Тарифы'),
          h('a', { href: '#/about' }, 'О центре'),
          h('a', { href: '#/contacts' }, 'Контакты')
        ),
        h('div', { class: 'public-footer-nav-col' },
          h('div', { class: 'public-footer-col-title' }, 'Кабинет'),
          h('a', { href: '#/login' }, 'Войти'),
          h('a', { href: '#/register' }, 'Регистрация'),
          h('a', { href: '#/tariffs' }, 'Подписка')
        )
      ),
      h('div', { class: 'public-footer-bottom' },
        h('div', null, '© 2026 Улыбка ребёнка. Все права защищены.'),
        h('div', null, '80% выручки — на благотворительность')
      )
    )
  );

  return h('div', { class: 'public-shell' },
    header,
    h('main', { class: 'public-main' }, options.content),
    footer,
    drawer
  );
}

// ============================================================
// APP LAYOUT
// ============================================================

export interface AppLayoutOptions {
  active?:
    | 'home'
    | 'subjects'
    | 'points'
    | 'payments'
    | 'catalog'
    | 'profile'
    | 'notifications'
    | 'achievements'
    | 'charity';
  title?: string;
  subtitle?: string;
  actions?: HTMLElement[];
  content: HTMLElement;
}

interface NavItem {
  key: string;
  label: string;
  icon: IconName;
  href: string;
}

const APP_NAV: NavItem[] = [
  { key: 'home', label: 'Главная', icon: 'home', href: '#/app' },
  { key: 'subjects', label: 'Дисциплины', icon: 'book-open', href: '#/app/subjects' },
  { key: 'points', label: 'Трудокоины', icon: 'award', href: '#/app/points' },
  { key: 'achievements', label: 'Достижения', icon: 'star', href: '#/app/achievements' },
  { key: 'catalog', label: 'Подарки', icon: 'gift', href: '#/app/catalog' },
  { key: 'charity', label: 'Помочь детям', icon: 'heart', href: '#/app/charity' },
  { key: 'payments', label: 'Подписка', icon: 'credit-card', href: '#/app/payments' },
  { key: 'notifications', label: 'Уведомления', icon: 'bell', href: '#/app/notifications' },
  { key: 'profile', label: 'Профиль', icon: 'user', href: '#/app/profile' },
];

const BOTTOM_NAV: NavItem[] = [
  { key: 'home', label: 'Главная', icon: 'home', href: '#/app' },
  { key: 'subjects', label: 'Тесты', icon: 'book-open', href: '#/app/subjects' },
  { key: 'points', label: 'Трудокоины', icon: 'award', href: '#/app/points' },
  { key: 'achievements', label: 'Достижения', icon: 'star', href: '#/app/achievements' },
  { key: 'catalog', label: 'Подарки', icon: 'gift', href: '#/app/catalog' },
];

export function appLayout(options: AppLayoutOptions): HTMLElement {
  const state = store.getState();
  const unread = state.notificationsUnread;
  const currentChild = state.children.find((c) => c.id === state.currentChildId) ?? null;
  const balance = currentChild?.balance ?? 0;

  // --- Drawer (выезжающая слева тёмная панель) ---

  let closeTimer: number | null = null;

  const drawerNav = h('nav', { class: 'app-drawer-nav' },
    ...APP_NAV.map((item) =>
      h('a', {
        href: item.href,
        class: options.active === item.key ? 'is-active' : '',
        onclick: () => closeDrawer(),
      },
        icon(item.icon, { size: 20 }),
        h('span', null, item.label)
      )
    )
  );

  const drawerBackdrop = h('div', {
    class: 'app-drawer-backdrop',
    onclick: () => closeDrawer(),
  });

  const drawer = h('div', { class: 'app-drawer', id: 'app-drawer' },
    drawerBackdrop,
    h('div', { class: 'app-drawer-panel' },
      h('div', { class: 'app-drawer-head' },
        brandMark({ size: 40, className: 'app-drawer-logo' }),
        h('div', { class: 'app-drawer-head-text' },
          h('div', { class: 'app-drawer-title' }, 'Улыбка ребёнка'),
          h('div', { class: 'app-drawer-subtitle' }, 'Личный кабинет')
        ),
        h('button', {
          class: 'app-drawer-close',
          type: 'button',
          'aria-label': 'Закрыть меню',
          onclick: () => closeDrawer(),
        }, icon('x', { size: 20 }))
      ),
      drawerNav,
      h('div', { class: 'app-drawer-foot' },
        h('a', {
          class: 'btn btn-secondary btn-block btn-sm',
          href: '#/app/profile',
          onclick: () => closeDrawer(),
        },
          icon('user', { size: 16, className: 'icon icon-sm' }),
          'Профиль'
        )
      )
    )
  );

  const openDrawer = (): void => {
    if (closeTimer !== null) { window.clearTimeout(closeTimer); closeTimer = null; }
    void drawer.offsetWidth;
    drawer.classList.add('is-open');
    document.body.classList.add('no-scroll');
    document.addEventListener('keydown', onKeydown);
  };

  const closeDrawer = (): void => {
    drawer.classList.remove('is-open');
    document.body.classList.remove('no-scroll');
    document.removeEventListener('keydown', onKeydown);
    if (closeTimer !== null) window.clearTimeout(closeTimer);
    closeTimer = window.setTimeout(() => { closeTimer = null; }, 320);
  };

  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') closeDrawer();
  };

  // --- Шапка ---

  const burgerBtn = h('button', {
    class: 'app-header-burger',
    type: 'button',
    'aria-label': 'Меню',
    'aria-controls': 'app-drawer',
    onclick: openDrawer,
  }, icon('menu', { size: 22 }));

  const balancePill = h('a', {
    class: 'app-header-balance',
    href: '#/app/points',
    title: 'Трудокоины',
    'aria-label': `Баланс: ${balance} трудокоинов`,
  },
    icon('award', { size: 16, className: 'icon icon-sm' }),
    h('span', { class: 'app-header-balance-value' }, String(balance))
  );

  const header = h('header', { class: 'app-header' },
    h('div', { class: 'app-header-inner' },
      burgerBtn,
      h('a', { class: 'public-logo', href: '#/app' },
        brandMark({ size: 32, className: 'app-header-logo' }),
        h('span', { class: 'hide-mobile' }, 'Улыбка ребёнка')
      ),
      h('div', { class: 'app-header-center' }),
      h('div', { class: 'app-header-right' },
        balancePill,
        h('a', {
          class: 'header-icon-btn',
          href: '#/app/notifications',
          title: 'Уведомления',
          'aria-label': 'Уведомления',
        },
          icon('bell', { size: 20 }),
          unread > 0
            ? h('span', { class: 'badge-count' }, unread > 9 ? '9+' : String(unread))
            : null
        ),
        userMenu({ variant: 'app' })
      )
    )
  );

  // --- Сайдбар (десктоп) ---

  const sidebar = h('aside', { class: 'app-sidebar' },
    h('nav', { class: 'app-sidebar-nav' },
      ...APP_NAV.map((item) => sidebarLink(item, options.active === item.key))
    )
  );

  // --- Заголовок страницы ---

  const pageHead = (options.title || options.actions)
    ? h('div', { class: 'page-head' },
        h('div', null,
          options.title ? h('h1', { class: 'page-title' }, options.title) : null,
          options.subtitle ? h('div', { class: 'page-subtitle' }, options.subtitle) : null
        ),
        options.actions ? h('div', { class: 'page-actions' }, ...options.actions) : null
      )
    : null;

  // --- Нижняя панель (мобила) ---

  const bottomNav = h('nav', { class: 'app-bottom-nav' },
    ...BOTTOM_NAV.map((item) => bottomNavLink(item, options.active === item.key))
  );

  // --- Реактивное обновление баланса при смене ребёнка ---

  const unsubscribe = store.subscribe((s) => {
    const child = s.children.find((c) => c.id === s.currentChildId) ?? null;
    const newBalance = child?.balance ?? 0;
    balancePill.replaceChildren(
      icon('award', { size: 16, className: 'icon icon-sm' }),
      h('span', { class: 'app-header-balance-value' }, String(newBalance))
    );
    balancePill.setAttribute('aria-label', `Баланс: ${newBalance} трудокоинов`);
  });

  const originalRemove = drawer.remove.bind(drawer);
  drawer.remove = function () {
    unsubscribe();
    closeDrawer();
    originalRemove();
  };

  return h('div', { class: 'app-shell' },
    header,
    sidebar,
    h('main', { class: 'app-main' },
      pageHead,
      options.content,
      h('div', { class: 'app-bottom-spacer', 'aria-hidden': 'true' })
    ),
    bottomNav,
    drawer
  );
}

function sidebarLink(item: NavItem, active: boolean): HTMLElement {
  return h('a', {
    href: item.href,
    class: active ? 'is-active' : '',
  },
    icon(item.icon, { size: 18 }),
    h('span', null, item.label)
  );
}

function bottomNavLink(item: NavItem, active: boolean): HTMLElement {
  return h('a', {
    href: item.href,
    class: active ? 'is-active' : '',
  },
    icon(item.icon, { size: 22 }),
    h('span', null, item.label)
  );
}

// ============================================================
// ADMIN LAYOUT
// ============================================================

export interface AdminLayoutOptions {
  active?: string;
  title: string;
  subtitle?: string;
  actions?: HTMLElement[];
  content: HTMLElement;
}

const ADMIN_NAV: NavItem[] = [
  { key: 'dashboard', label: 'Дашборд', icon: 'pie-chart', href: '#/admin' },
  { key: 'users', label: 'Пользователи', icon: 'users', href: '#/admin/users' },
  { key: 'subjects', label: 'Дисциплины', icon: 'book-open', href: '#/admin/subjects' },
  { key: 'tests', label: 'Тесты', icon: 'file-text', href: '#/admin/tests' },
  { key: 'questions', label: 'Банк вопросов', icon: 'hash', href: '#/admin/questions' },
  { key: 'question-types', label: 'Типы вопросов', icon: 'sliders', href: '#/admin/question-types' },
  { key: 'points', label: 'Трудокоины', icon: 'award', href: '#/admin/points' },
  { key: 'finance', label: 'Финансы', icon: 'dollar-sign', href: '#/admin/finance' },
  { key: 'mailings', label: 'Рассылки', icon: 'send', href: '#/admin/mailings' },
  { key: 'checks', label: 'Очные проверки', icon: 'shield', href: '#/admin/checks' },
  { key: 'anomalies', label: 'Аномалии', icon: 'activity', href: '#/admin/anomalies' },
  { key: 'audit', label: 'Аудит', icon: 'eye', href: '#/admin/audit' },
];

export function adminLayout(options: AdminLayoutOptions): HTMLElement {
  const state = store.getState();
  const user = state.user;
  const isSuperAdmin = user?.role === 'superadmin';

  const visibleNav = ADMIN_NAV.filter((item) => {
    if (item.key === 'audit' && !isSuperAdmin) return false;
    return true;
  });

  const sidebarNav = h('nav', { class: 'admin-sidebar-nav' },
    ...visibleNav.map((item) => sidebarLink(item, options.active === item.key))
  );

  const sidebar = h('aside', { class: 'admin-sidebar' },
    h('div', { class: 'admin-sidebar-brand' },
      brandMark({ size: 34, className: 'admin-sidebar-logo' }),
      h('span', null, 'Админка')
    ),
    sidebarNav
  );

  let closeTimer: number | null = null;

  const drawerPanel = h('div', { class: 'admin-drawer-panel' },
    h('div', { class: 'admin-sidebar-brand' },
      brandMark({ size: 34, className: 'admin-sidebar-logo' }),
      h('span', null, 'Админка')
    ),
    h('nav', { class: 'admin-sidebar-nav' },
      ...visibleNav.map((item) => {
        const link = sidebarLink(item, options.active === item.key);
        link.addEventListener('click', () => closeDrawer());
        return link;
      })
    )
  );

  const drawerBackdrop = h('div', {
    class: 'admin-drawer-backdrop',
    onclick: () => closeDrawer(),
  });

  const drawer = h('div', { class: 'admin-drawer', id: 'admin-drawer' },
    drawerBackdrop,
    drawerPanel
  );

  const openDrawer = (): void => {
    if (closeTimer !== null) { window.clearTimeout(closeTimer); closeTimer = null; }
    void drawer.offsetWidth;
    drawer.classList.add('is-open');
    document.body.classList.add('no-scroll');
    document.addEventListener('keydown', onKeydown);
  };

  const closeDrawer = (): void => {
    drawer.classList.remove('is-open');
    document.body.classList.remove('no-scroll');
    document.removeEventListener('keydown', onKeydown);
    if (closeTimer !== null) window.clearTimeout(closeTimer);
    closeTimer = window.setTimeout(() => { closeTimer = null; }, 320);
  };

  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') closeDrawer();
  };

  const header = h('header', { class: 'admin-header' },
    h('button', {
      class: 'header-icon-btn admin-header-menu',
      type: 'button',
      onclick: openDrawer,
      'aria-label': 'Меню',
      'aria-controls': 'admin-drawer',
    }, icon('menu', { size: 20 })),
    h('div', { class: 'admin-header-title' }, options.title),
    h('div', { class: 'grow' }),
    h('a', {
      class: 'btn btn-secondary btn-sm hide-mobile',
      href: '#/app',
      title: 'Клиентская версия',
    },
      icon('log-out', { size: 14, className: 'icon icon-sm' }),
      'К клиенту'
    ),
    userMenu({ variant: 'admin' })
  );

  const pageHead = h('div', { class: 'page-head' },
    h('div', null,
      h('h1', { class: 'page-title' }, options.title),
      options.subtitle ? h('div', { class: 'page-subtitle' }, options.subtitle) : null
    ),
    options.actions ? h('div', { class: 'page-actions' }, ...options.actions) : null
  );

  return h('div', { class: 'admin-shell' },
    header,
    sidebar,
    h('main', { class: 'admin-main' },
      pageHead,
      options.content
    ),
    drawer
  );
}

// ============================================================
// PARTNER LAYOUT
// ============================================================

export interface PartnerLayoutOptions {
  active?: 'dashboard' | 'offers' | 'redemptions';
  title: string;
  subtitle?: string;
  actions?: HTMLElement[];
  content: HTMLElement;
}

const PARTNER_NAV: NavItem[] = [
  { key: 'dashboard', label: 'Обзор', icon: 'pie-chart', href: '#/partner' },
  { key: 'offers', label: 'Офферы', icon: 'gift', href: '#/partner/offers' },
  { key: 'redemptions', label: 'Обмены', icon: 'award', href: '#/partner/redemptions' },
];

export function partnerLayout(options: PartnerLayoutOptions): HTMLElement {
  const sidebarNav = h('nav', { class: 'partner-sidebar-nav' },
    ...PARTNER_NAV.map((item) =>
      h('a', {
        href: item.href,
        class: options.active === item.key ? 'is-active' : '',
      },
        icon(item.icon, { size: 18 }),
        h('span', null, item.label)
      )
    )
  );

  const sidebar = h('aside', { class: 'partner-sidebar' },
    h('div', { class: 'partner-sidebar-brand' },
      brandMark({ size: 34, className: 'partner-sidebar-logo' }),
      h('span', null, 'Кабинет партнёра')
    ),
    sidebarNav
  );

  const header = h('header', { class: 'partner-header' },
    h('div', { class: 'partner-header-inner' },
      h('a', { class: 'public-logo', href: '#/partner' },
        brandMark({ size: 36, className: 'partner-header-logo' }),
        h('span', { class: 'hide-mobile' }, 'Кабинет партнёра')
      ),
      h('div', { class: 'grow' }),
      h('div', { class: 'row gap-2' },
        h('a', {
          class: 'btn btn-secondary btn-sm hide-mobile',
          href: '#/app',
        },
          icon('home', { size: 14, className: 'icon icon-sm' }),
          'К клиенту'
        ),
        userMenu({ variant: 'partner' })
      )
    )
  );

  const bottomNav = h('nav', { class: 'partner-bottom-nav' },
    ...PARTNER_NAV.map((item) =>
      h('a', {
        href: item.href,
        class: options.active === item.key ? 'is-active' : '',
      },
        icon(item.icon, { size: 22 }),
        h('span', null, item.label)
      )
    )
  );

  const pageHead = h('div', { class: 'page-head' },
    h('div', null,
      h('h1', { class: 'page-title' }, options.title),
      options.subtitle ? h('div', { class: 'page-subtitle' }, options.subtitle) : null
    ),
    options.actions ? h('div', { class: 'page-actions' }, ...options.actions) : null
  );

  return h('div', { class: 'partner-shell' },
    header,
    sidebar,
    h('main', { class: 'partner-main' },
      pageHead,
      options.content,
      h('div', { class: 'partner-bottom-spacer', 'aria-hidden': 'true' })
    ),
    bottomNav
  );
}

// ============================================================
// HELPERS
// ============================================================

export function setRoot(node: HTMLElement): void {
  const root = document.getElementById('app');
  if (!root) return;
  root.replaceChildren(node);
  window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
}

export function navigateTo(path: string): void {
  router.navigate(path);
}

export function backLink(label: string, href: string): HTMLElement {
  return h('a', { class: 'btn btn-ghost btn-sm', href },
    icon('arrow-left', { size: 16, className: 'icon icon-sm' }),
    h('span', null, label)
  );
}