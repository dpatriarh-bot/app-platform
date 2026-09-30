// ============================================================
// main.ts — точка входа SPA
// + анимированный favicon «Солнышко».
// ============================================================

import './styles/tokens.css';
import './styles/base.css';
import './styles/utilities.css';
import './styles/components.css';
import './styles/layout.css';
import './styles/responsive.css';
import './styles/public.css';
import './styles/app.css';
import './styles/admin.css';
import './styles/partner.css';
import './styles/animations.css';
import './styles/test.css';
import './styles/result.css';

import { router } from './lib/router.js';
import { api, isApiError } from './lib/api.js';
import { store } from './lib/store.js';
import { bootstrapUserState } from './lib/bootstrap.js';
import { ensureConsent } from './lib/consent.js';
import { startAnimatedFavicon } from './lib/favicon.js';

// Public
import { renderPublicHome } from './pages/public/home.js';
import { renderPublicTariffs } from './pages/public/tariffs.js';
import { renderPublicAbout } from './pages/public/about.js';
import { renderPublicContacts } from './pages/public/contacts.js';

// Auth
import { renderLogin } from './pages/auth/login.js';
import { renderRegister } from './pages/auth/register.js';
import { renderForgot } from './pages/auth/forgot.js';
import { renderReset } from './pages/auth/reset.js';

// App (личный кабинет)
import { renderAppDashboard } from './pages/app/dashboard.js';
import { renderAppProfile } from './pages/app/profile.js';
import { renderAppSubjects } from './pages/app/subjects.js';
import { renderAppTests } from './pages/app/tests.js';
import { renderAppTest } from './pages/app/test.js';
import { renderAppResult } from './pages/app/result.js';
import { renderAppPayments } from './pages/app/payments.js';
import { renderAppCatalog } from './pages/app/catalog.js';
import { renderAppNotifications } from './pages/app/notifications.js';
import { renderAppPoints } from './pages/app/points.js';
import { renderAppCheck } from './pages/app/check.js';
import { renderAppAchievements } from './pages/app/achievements.js';
import { renderAppCharity } from './pages/app/charity.js';

// Admin
import { renderAdminDashboard } from './pages/admin/dashboard.js';
import { renderAdminUsers } from './pages/admin/users.js';
import { renderAdminUserDetail } from './pages/admin/user-detail.js';
import { renderAdminSubjects } from './pages/admin/subjects.js';
import { renderAdminTests } from './pages/admin/tests.js';
import { renderAdminTestEdit } from './pages/admin/test-edit.js';
import { renderAdminQuestions } from './pages/admin/questions.js';
import { renderAdminQuestionTypes } from './pages/admin/question-types.js';
import { renderAdminPoints } from './pages/admin/points.js';
import { renderAdminFinance } from './pages/admin/finance.js';
import { renderAdminMailings } from './pages/admin/mailings.js';
import { renderAdminChecks } from './pages/admin/checks.js';
import { renderAdminAudit } from './pages/admin/audit.js';
import { renderAdminAnomalies } from './pages/admin/anomalies.js';

// Partner
import { renderPartnerDashboard } from './pages/partner/dashboard.js';
import { renderPartnerOffers } from './pages/partner/offers.js';
import { renderPartnerRedemptions } from './pages/partner/redemptions.js';

// Not found
import { renderNotFound } from './pages/not-found.js';

// ============================================================
// GUARDS
// ============================================================

function getRoleHome(): string {
  const user = store.getState().user;
  if (!user) return '/login';
  switch (user.role) {
    case 'partner':
      return '/partner';
    case 'manager':
    case 'curator':
    case 'admin':
    case 'superadmin':
      return '/admin';
    default:
      return '/app';
  }
}

function requireAuth(ctx: { path: string }): boolean | string {
  const user = store.getState().user;
  if (!user) {
    const returnUrl = encodeURIComponent(ctx.path);
    return `/login?return=${returnUrl}`;
  }
  return true;
}

function requireParent(): boolean | string {
  const user = store.getState().user;
  if (!user) return '/login';
  if (user.role !== 'parent') return getRoleHome();
  return true;
}

function requireStaff(): boolean | string {
  const user = store.getState().user;
  if (!user) return '/login';
  if (!['manager', 'curator', 'admin', 'superadmin'].includes(user.role)) {
    return getRoleHome();
  }
  return true;
}

function requirePartner(): boolean | string {
  const user = store.getState().user;
  if (!user) return '/login';
  if (user.role !== 'partner') return getRoleHome();
  return true;
}

function guestOnly(): boolean | string {
  if (store.getState().user) {
    return getRoleHome();
  }
  return true;
}

// ============================================================
// BOOTSTRAP AUTH
// ============================================================

async function bootstrapAuth(): Promise<void> {
  try {
    const res = await api.get<{
      user: {
        id: string;
        role: 'parent' | 'partner' | 'manager' | 'curator' | 'admin' | 'superadmin';
        status: string;
        phone: string;
        email: string | null;
        totpEnabled: boolean;
        consentVersion: string | null;
      };
    }>('/auth/me', { skipRefresh: false });

    store.setState({ user: res.user });
  } catch (err) {
    if (isApiError(err) && err.status === 401) {
      store.setState({ user: null });
    } else {
      // eslint-disable-next-line no-console
      console.warn('auth bootstrap failed', err);
      store.setState({ user: null });
    }
  }
}

// ============================================================
// ROUTES
// ============================================================

function registerRoutes(): void {
  // ---------- Public ----------
  router.register('/', renderPublicHome, { title: 'Главная' });
  router.register('/tariffs', renderPublicTariffs, { title: 'Тарифы' });
  router.register('/about', renderPublicAbout, { title: 'О центре' });
  router.register('/contacts', renderPublicContacts, { title: 'Контакты' });

  // ---------- Auth ----------
  router.register('/login', renderLogin, { title: 'Вход', guards: [guestOnly] });
  router.register('/register', renderRegister, { title: 'Регистрация', guards: [guestOnly] });
  router.register('/forgot', renderForgot, { title: 'Восстановление пароля', guards: [guestOnly] });
  router.register('/reset', renderReset, { title: 'Новый пароль' });

  // ---------- App (ЛК родителя) ----------
  router.register('/app', renderAppDashboard, { title: 'Личный кабинет', guards: [requireParent] });
  router.register('/app/profile', renderAppProfile, { title: 'Профиль', guards: [requireParent] });
  router.register('/app/subjects', renderAppSubjects, { title: 'Дисциплины', guards: [requireParent] });
  router.register('/app/tests', renderAppTests, { title: 'Тесты', guards: [requireParent] });
  router.register('/app/test/:id', renderAppTest, { title: 'Прохождение теста', guards: [requireParent] });
  router.register('/app/result/:attemptId', renderAppResult, { title: 'Результат', guards: [requireParent] });
  router.register('/app/payments', renderAppPayments, { title: 'Подписка', guards: [requireParent] });
  router.register('/app/catalog', renderAppCatalog, { title: 'Подарки', guards: [requireParent] });
  router.register('/app/notifications', renderAppNotifications, { title: 'Уведомления', guards: [requireParent] });
  router.register('/app/points', renderAppPoints, { title: 'Трудокоины', guards: [requireParent] });
  router.register('/app/achievements', renderAppAchievements, { title: 'Достижения', guards: [requireParent] });
  router.register('/app/charity', renderAppCharity, { title: 'Помочь детям', guards: [requireParent] });
  router.register('/app/check/:id', renderAppCheck, { title: 'Очная проверка', guards: [requireAuth] });

  // ---------- Admin ----------
  router.register('/admin', renderAdminDashboard, { title: 'Админ-дашборд', guards: [requireStaff] });
  router.register('/admin/users', renderAdminUsers, { title: 'Пользователи', guards: [requireStaff] });
  router.register('/admin/users/:id', renderAdminUserDetail, { title: 'Пользователь', guards: [requireStaff] });
  router.register('/admin/subjects', renderAdminSubjects, { title: 'Дисциплины', guards: [requireStaff] });
  router.register('/admin/tests', renderAdminTests, { title: 'Тесты', guards: [requireStaff] });
  router.register('/admin/tests/:id', renderAdminTestEdit, { title: 'Редактор теста', guards: [requireStaff] });
  router.register('/admin/questions', renderAdminQuestions, { title: 'Банк вопросов', guards: [requireStaff] });
  router.register('/admin/question-types', renderAdminQuestionTypes, { title: 'Типы вопросов', guards: [requireStaff] });
  router.register('/admin/points', renderAdminPoints, { title: 'Трудокоины', guards: [requireStaff] });
  router.register('/admin/finance', renderAdminFinance, { title: 'Финансы', guards: [requireStaff] });
  router.register('/admin/mailings', renderAdminMailings, { title: 'Рассылки', guards: [requireStaff] });
  router.register('/admin/checks', renderAdminChecks, { title: 'Очные проверки', guards: [requireStaff] });
  router.register('/admin/anomalies', renderAdminAnomalies, { title: 'Аномалии', guards: [requireStaff] });
  router.register('/admin/audit', renderAdminAudit, { title: 'Аудит', guards: [requireStaff] });

  // ---------- Partner ----------
  router.register('/partner', renderPartnerDashboard, { title: 'Кабинет партнёра', guards: [requirePartner] });
  router.register('/partner/offers', renderPartnerOffers, { title: 'Офферы партнёра', guards: [requirePartner] });
  router.register('/partner/redemptions', renderPartnerRedemptions, { title: 'Обмены партнёра', guards: [requirePartner] });

  // ---------- Not found ----------
  router.setNotFound(renderNotFound);
}

// ============================================================
// BOOT
// ============================================================

async function boot(): Promise<void> {
  startAnimatedFavicon();

  await bootstrapAuth();

  if (store.getState().user) {
    await bootstrapUserState();
    void ensureConsent();
  }

  registerRoutes();
  router.start();

  const loader = document.getElementById('app-loader');
  if (loader) {
    loader.classList.add('is-hidden');
    setTimeout(() => loader.remove(), 300);
  }
}

void boot();