// ============================================================
// links.ts — централизованное построение ссылок для уведомлений
// Все ссылки — hash-пути SPA (без ведущего #).
// ============================================================

export const link = {
  home: () => '/',
  tariffs: () => '/tariffs',
  about: () => '/about',
  contacts: () => '/contacts',
  login: () => '/login',
  register: () => '/register',

  app: () => '/app',
  profile: (tab?: 'profile' | 'children' | 'security' | 'data') =>
    tab ? `/app/profile?tab=${tab}` : '/app/profile',
  subjects: () => '/app/subjects',
  testsFor: (slug: string) => `/app/tests?subject=${encodeURIComponent(slug)}`,
  test: (attemptId: string) => `/app/test/${attemptId}`,
  result: (attemptId: string) => `/app/result/${attemptId}`,
  payments: () => '/app/payments',
  catalog: () => '/app/catalog',
  catalogRedemptions: () => '/app/catalog?tab=redemptions',
  notifications: () => '/app/notifications',
  points: () => '/app/points',
  check: (spotCheckId: string) => `/app/check/${spotCheckId}`,

  admin: () => '/admin',
  adminUsers: () => '/admin/users',
  adminUser: (id: string) => `/admin/users/${id}`,
  adminSubjects: () => '/admin/subjects',
  adminTests: () => '/admin/tests',
  adminTest: (id: string) => `/admin/tests/${id}`,
  adminQuestions: () => '/admin/questions',
  adminQuestionTypes: () => '/admin/question-types',
  adminPoints: () => '/admin/points',
  adminFinance: () => '/admin/finance',
  adminMailings: () => '/admin/mailings',
  adminChecks: () => '/admin/checks',
  adminCheck: (id: string) => `/admin/checks?open=${id}`,
  adminAnomalies: () => '/admin/anomalies',
  adminAudit: () => '/admin/audit',

  partner: () => '/partner',
  partnerOffers: () => '/partner/offers',
  partnerRedemptions: () => '/partner/redemptions',
} as const;