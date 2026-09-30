// ============================================================
// pages/app/tests.ts — список тестов дисциплины
// ============================================================

import { h, mount } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { api, isApiError } from '../../lib/api.js';
import { store } from '../../lib/store.js';
import { router } from '../../lib/router.js';
import { appLayout, setRoot, backLink } from '../../components/layout.js';
import { emptyState, loader } from '../../components/ui.js';
import { loadCurrentChild } from '../../components/child-switcher.js';
import { openModal } from '../../lib/modal.js';
import { formatDuration } from '../../lib/format.js';
import { toastError } from '../../lib/toast.js';

interface TestItem {
  id: string;
  subjectId: string;
  title: string;
  description: string | null;
  timeLimitSec: number;
  gradeMin: number | null;
  gradeMax: number | null;
  pointsFixed: number;
  pointsPerCorrect: number;
  questionsCount: number;
  allowRetake: boolean;
}

interface SubjectInfo {
  id: string;
  slug: string;
  title: string;
  icon: string | null;
  color: string | null;
}

interface ActiveAttempt {
  id: string;
  testTitle: string;
  startedAt: string;
  totalCount: number;
  correctCount: number;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function renderAppTests(): Promise<void> {
  const subjectSlug = getSubjectFromUrl();
  if (!subjectSlug) {
    router.navigate('/app/subjects');
    return;
  }

  const root = h('div');
  setRoot(appLayout({ active: 'subjects', title: 'Тесты', content: root }));
  mount(root, loader());

  try {
    const ctx = await loadCurrentChild();
    if ('redirect' in ctx) {
      router.navigate(ctx.redirect);
      return;
    }

    const childId = ctx.childId;

    let subject: SubjectInfo;
    try {
      const subjectRes = await api.get<{ subject: SubjectInfo }>(
        `/subjects/${encodeURIComponent(subjectSlug)}`
      );
      subject = subjectRes.subject;
    } catch (err) {
      if (isApiError(err) && err.status === 404) {
        toastError('Дисциплина не найдена');
        router.navigate('/app/subjects');
        return;
      }
      throw err;
    }

    const [testsRes, activeAttemptRes] = await Promise.all([
      api.get<{ items: TestItem[] }>(
        `/tests?forChildId=${encodeURIComponent(childId)}&subjectId=${encodeURIComponent(subject.id)}`
      ),
      api.get<{ items: ActiveAttempt[] }>(
        `/attempts?childId=${encodeURIComponent(childId)}&status=in_progress&limit=1`
      ).catch(() => ({ items: [] as ActiveAttempt[] })),
    ]);

    const tests = testsRes.items;
    const activeAttempt = activeAttemptRes.items[0] ?? null;

    const activeAttemptBanner = activeAttempt
      ? h('div', {
          class: 'card card-pad anim-slide-up',
          style: 'background: linear-gradient(135deg, var(--c-info-bg) 0%, var(--c-surface) 100%); border-color: var(--c-info);',
        },
          h('div', { class: 'row-between row-wrap gap-3' },
            h('div', { class: 'row gap-3' },
              h('div', {
                class: 'feature-icon',
                style: 'margin: 0; width: 48px; height: 48px; background: var(--c-info-bg); color: var(--c-sky-700);',
              }, icon('play', { size: 22 })),
              h('div', null,
                h('div', { class: 'fw-700' }, 'У вас есть незавершённая попытка'),
                h('div', { class: 'text-sm text-muted mt-1' },
                  `«${activeAttempt.testTitle}» — ${activeAttempt.correctCount}/${activeAttempt.totalCount}`
                )
              )
            ),
            h('a', {
              class: 'btn',
              href: `#/app/test/${activeAttempt.id}`,
            },
              icon('arrow-right', { size: 16, className: 'icon icon-sm' }),
              'Продолжить'
            )
          )
        )
      : null;

    const content = h('div', { class: 'stack-lg' },
      h('div', { class: 'anim-slide-up' },
        backLink('Все дисциплины', '#/app/subjects')
      ),

      activeAttemptBanner,

      h('div', { class: 'row gap-4 anim-slide-up delay-1' },
        h('div', {
          class: 'subject-card-icon',
          style: `background: ${subject.color ?? 'var(--c-primary)'}; margin-bottom: 0;`,
        }, icon('book-open', { size: 24 })),
        h('div', null,
          h('h1', { class: 'page-title', style: 'font-size: var(--fz-2xl);' }, subject.title),
          h('div', { class: 'text-sm text-muted mt-1' },
            `${tests.length} ${pluralTests(tests.length)} доступно`
          )
        )
      ),

      tests.length === 0
        ? emptyState({
            illustration: 'no-tests',
            title: 'Нет доступных тестов',
            description: 'Для вашего класса пока нет опубликованных тестов по этой дисциплине. Загляните позже.',
            action: h('a', { class: 'btn', href: '#/app/subjects' }, 'К дисциплинам'),
          })
        : h('div', { class: 'stack stagger' },
            ...tests.map((t) => renderTestCard(t, activeAttempt !== null))
          )
    );

    mount(root, content);
  } catch (err) {
    mount(root, emptyState({
      illustration: 'error',
      title: 'Не удалось загрузить тесты',
      description: isApiError(err) ? err.message : 'Попробуйте позже',
      action: h('button', {
        class: 'btn',
        type: 'button',
        onclick: () => router.reload(),
      }, 'Обновить'),
    }));
  }
}

function renderTestCard(test: TestItem, hasActiveAttempt: boolean): HTMLElement {
  const startBtn = h('button', {
    class: 'btn',
    type: 'button',
    disabled: hasActiveAttempt,
    title: hasActiveAttempt ? 'Завершите активную попытку' : '',
    onclick: () => void startTest(test.id),
  },
    icon('play', { size: 18 }),
    hasActiveAttempt ? 'Недоступно' : 'Начать'
  );

  const gradeInfo = test.gradeMin || test.gradeMax
    ? `${test.gradeMin ?? '—'}–${test.gradeMax ?? '—'} класс`
    : 'Без ограничений';

  const totalPoints = test.pointsFixed + test.pointsPerCorrect * test.questionsCount;

  return h('div', { class: 'test-card stagger-item' },
    h('div', { class: 'test-card-body' },
      h('div', { class: 'test-card-title' }, test.title),
      test.description ? h('div', { class: 'test-card-description' }, test.description) : null,
      h('div', { class: 'test-card-meta' },
        h('span', { class: 'test-card-meta-item' },
          icon('file-text', { size: 12, className: 'icon icon-sm' }),
          `${test.questionsCount} вопросов`
        ),
        h('span', { class: 'test-card-meta-item' },
          icon('clock', { size: 12, className: 'icon icon-sm' }),
          formatDuration(test.timeLimitSec)
        ),
        h('span', { class: 'test-card-meta-item is-success' },
          icon('award', { size: 12, className: 'icon icon-sm' }),
          `до +${totalPoints} трудокоинов`
        ),
        h('span', { class: 'test-card-meta-item' }, gradeInfo)
      )
    ),
    startBtn
  );
}

async function startTest(testId: string): Promise<void> {
  if (!testId || !UUID_REGEX.test(testId)) {
    toastError('Некорректный тест. Обновите страницу.');
    return;
  }

  const ctx = await loadCurrentChild();
  if ('redirect' in ctx) {
    toastError('Не выбран ребёнок. Вернитесь в профиль.');
    router.navigate(ctx.redirect);
    return;
  }

  const childId = ctx.childId;

  if (!childId || !UUID_REGEX.test(childId)) {
    toastError('Не выбран ребёнок. Обновите страницу.');
    return;
  }

  const state = store.getState();
  if (state.loading) return;
  store.setState({ loading: true });

  try {
    const res = await api.post<{ attemptId: string }>('/attempts/start', {
      testId,
      childId,
      deviceFingerprint: getFingerprint(),
    });

    router.navigate(`/app/test/${res.attemptId}`);
  } catch (err) {
    if (isApiError(err)) {
      if (err.code === 'SUBSCRIPTION_REQUIRED') {
        showSubscriptionModal();
      } else if (err.code === 'PARALLEL_SESSION') {
        await showParallelSessionModal(childId);
      } else if (err.status === 422) {
        toastError('Не удалось начать тест. Проверьте страницу.');
      } else {
        toastError(err.message);
      }
    } else {
      toastError('Не удалось начать тест');
    }
  } finally {
    store.setState({ loading: false });
  }
}

function showSubscriptionModal(): void {
  openModal({
    title: 'Нужна активная подписка',
    body: h('div', { class: 'stack' },
      h('div', { class: 'alert alert-warning' },
        icon('credit-card', { size: 18, className: 'icon icon-sm alert-icon' }),
        h('div', null,
          h('div', { class: 'alert-title' }, 'Подписка не активна'),
          'Чтобы ребёнок мог проходить тесты и зарабатывать трудокоины, оформите подписку.'
        )
      ),
      h('p', { class: 'text-sm text-muted' },
        'Оплата — 190 ₽ в месяц. Автопродление можно отключить в любой момент.'
      )
    ),
    actions: [
      { label: 'Позже', variant: 'secondary' },
      {
        label: 'Оформить подписку',
        variant: 'primary',
        onClick: () => {
          router.navigate('/app/payments');
        },
      },
    ],
    size: 'md',
  });
}

async function showParallelSessionModal(childId: string): Promise<void> {
  let activeId: string | null = null;
  try {
    const res = await api.get<{ items: ActiveAttempt[] }>(
      `/attempts?childId=${encodeURIComponent(childId)}&status=in_progress&limit=1`
    );
    activeId = res.items[0]?.id ?? null;
  } catch {
    // ignore
  }

  openModal({
    title: 'Активная попытка',
    body: h('div', { class: 'stack' },
      h('p', { class: 'text-sm text-muted' },
        'У вас уже есть незавершённая попытка. Продолжите её или подождите 30 минут — система автоматически её закроет.'
      )
    ),
    actions: [
      { label: 'Закрыть', variant: 'secondary' },
      activeId
        ? {
            label: 'Перейти к попытке',
            variant: 'primary',
            onClick: () => {
              router.navigate(`/app/test/${activeId}`);
            },
          }
        : {
            label: 'В кабинет',
            variant: 'primary',
            onClick: () => {
              router.navigate('/app');
            },
          },
    ],
    size: 'md',
  });
}

function pluralTests(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return 'тест';
  if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) return 'теста';
  return 'тестов';
}

function getSubjectFromUrl(): string | null {
  const hash = window.location.hash;
  const qIdx = hash.indexOf('?');
  if (qIdx === -1) return null;
  const params = new URLSearchParams(hash.slice(qIdx + 1));
  return params.get('subject');
}

function getFingerprint(): string {
  const parts = [
    navigator.userAgent,
    navigator.language,
    screen.width,
    screen.height,
    new Date().getTimezoneOffset(),
  ];
  let hash = 0;
  const str = parts.join('|');
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    hash = (hash << 5) - hash + c;
    hash |= 0;
  }
  return Math.abs(hash).toString(36).padStart(8, '0').slice(0, 16);
}