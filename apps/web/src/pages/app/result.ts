// ============================================================
// pages/app/result.ts — результат теста с подробным разбором
// Все 7 типов вопросов разбираются человекочитаемо.
// ============================================================

import { h, mount, clear } from '../../lib/dom.js';
import { icon, type IconName } from '../../lib/icons.js';
import { api, isApiError } from '../../lib/api.js';
import { store } from '../../lib/store.js';
import { router } from '../../lib/router.js';
import { appLayout, setRoot } from '../../components/layout.js';
import { emptyState, loader } from '../../components/ui.js';
import { formatDuration } from '../../lib/format.js';

type QuestionType =
  | 'input_number'
  | 'input_text'
  | 'single_choice'
  | 'multi_choice'
  | 'matching'
  | 'ordering'
  | 'formula';

interface ResultQuestion {
  id: string;
  type: QuestionType;
  text: string;
  imageUrl: string | null;
  explanation: string | null;
  userAnswer: unknown;
  correctAnswer: unknown;
  isCorrect: boolean | null;
  pointsEarned: number;
}

interface ResultData {
  attemptId: string;
  testId: string;
  testTitle: string;
  childId: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  timeSpentSec: number | null;
  totalCount: number;
  correctCount: number;
  wrongCount: number;
  skippedCount: number;
  scorePoints: number;
  percentCorrect: number;
  pointsAwarded: boolean;
  suspicionScore: number;
  fraudFlags: string[];
  questions: ResultQuestion[];
}

const TYPE_LABELS: Record<QuestionType, { label: string; icon: IconName }> = {
  input_number: { label: 'Число', icon: 'hash' },
  input_text: { label: 'Текст', icon: 'edit-2' },
  single_choice: { label: 'Один вариант', icon: 'check-circle' },
  multi_choice: { label: 'Несколько вариантов', icon: 'check-square' },
  matching: { label: 'Сопоставление', icon: 'link' },
  ordering: { label: 'Порядок', icon: 'list' },
  formula: { label: 'Формула', icon: 'zap' },
};

type FilterKey = 'all' | 'wrong' | 'skipped' | 'correct';

// ============================================================
// ENTRY
// ============================================================

export async function renderAppResult(ctx: {
  params: { attemptId: string };
}): Promise<void> {
  const attemptId = ctx.params.attemptId;

  const root = h('div');
  setRoot(appLayout({ active: 'home', title: 'Результат', content: root }));
  mount(root, loader('Загружаем результат...'));

  try {
    const res = await api.get<{ result: ResultData }>(`/attempts/${attemptId}/result`);
    const result = res.result;

    if (result.pointsAwarded && result.scorePoints > 0) {
      void refreshBalances();
    }

    const page = renderResultPage(result);
    mount(root, page);
  } catch (err) {
    mount(
      root,
      emptyState({
        illustration: 'error',
        title: 'Не удалось загрузить результат',
        description: isApiError(err) ? err.message : 'Попробуйте позже',
        action: h('a', { class: 'btn', href: '#/app' }, 'В кабинет'),
      })
    );
  }
}

// ============================================================
// PAGE
// ============================================================

function renderResultPage(result: ResultData): HTMLElement {
  const percent = Math.round(result.percentCorrect);
  const mood = classifyMood(result);

  const host = h('div', { class: 'stack-lg' });

  // 1. Hero
  host.appendChild(renderHero(result, percent, mood));

  // 2. Метрики
  host.appendChild(renderStats(result));

  // 3. Алерты
  const alert = renderStatusAlert(result, percent);
  if (alert) host.appendChild(alert);

  // 4. Разбор ответов
  host.appendChild(renderReview(result));

  // 5. Footer
  host.appendChild(renderActions(result));

  return host;
}

type Mood = 'success' | 'partial' | 'fail';

function classifyMood(result: ResultData): Mood {
  if (result.status === 'blocked') return 'fail';
  if (result.percentCorrect >= 80) return 'success';
  if (result.percentCorrect >= 50) return 'partial';
  return 'fail';
}

// ============================================================
// HERO
// ============================================================

function renderHero(result: ResultData, percent: number, mood: Mood): HTMLElement {
  const iconName: IconName =
    result.status === 'blocked'
      ? 'shield-off'
      : mood === 'success'
        ? 'award'
        : mood === 'partial'
          ? 'trending-up'
          : 'target';

  const eyebrow =
    result.status === 'blocked'
      ? 'Заблокировано куратором'
      : result.status === 'flagged'
        ? 'Помечено для проверки'
        : 'Результат теста';

  const title =
    mood === 'success'
      ? 'Превосходно! 🎉'
      : mood === 'partial'
        ? 'Хороший результат'
        : 'Есть куда расти';

  const subtitle =
    mood === 'success'
      ? `Тест «${result.testTitle}» пройден на отлично. Так держать!`
      : mood === 'partial'
        ? `Тест «${result.testTitle}» пройден, но есть над чем поработать.`
        : `Тест «${result.testTitle}» завершён. Разберите ошибки ниже — это поможет в следующий раз.`;

  const scoreEl = h(
    'div',
    { class: 'result-hero-score' },
    h('div', { class: 'result-hero-score-value' }, `${percent}%`),
    h('div', { class: 'result-hero-score-label' }, 'правильных')
  );

  const fill = h('div', { class: 'result-hero-progress-fill' });
  // Анимируем ширину
  requestAnimationFrame(() => {
    setTimeout(() => {
      fill.style.width = `${percent}%`;
    }, 200);
  });

  const progressMeta = h(
    'div',
    { class: 'result-hero-progress-meta' },
    h(
      'span',
      null,
      h('strong', null, String(result.correctCount)),
      ` из ${result.totalCount} правильных`
    ),
    h(
      'span',
      null,
      h('strong', null, `+${result.scorePoints}`),
      ' трудокоинов'
    ),
    result.timeSpentSec
      ? h(
          'span',
          null,
          'Время: ',
          h('strong', null, formatDuration(result.timeSpentSec))
        )
      : null
  );

  return h(
    'div',
    { class: `result-hero anim-slide-up is-${mood}` },
    h(
      'div',
      { class: 'result-hero-top' },
      h(
        'div',
        { class: 'result-hero-badge' },
        icon(iconName, { size: 44, className: 'icon' })
      ),
      h(
        'div',
        { class: 'result-hero-info' },
        h('div', { class: 'result-hero-eyebrow' }, eyebrow),
        h('div', { class: 'result-hero-title' }, title),
        h('div', { class: 'result-hero-sub' }, subtitle)
      ),
      scoreEl
    ),
    h(
      'div',
      { class: 'result-hero-progress' },
      h('div', { class: 'result-hero-progress-track' }, fill),
      progressMeta
    )
  );
}

// ============================================================
// METRICS
// ============================================================

function renderStats(result: ResultData): HTMLElement {
  const percent = Math.round(result.percentCorrect);

  const grid = h('div', { class: 'result-stats' });

  grid.appendChild(
    statCard({
      label: 'Правильные',
      value: String(result.correctCount),
      hint: `из ${result.totalCount} вопросов`,
      icon: 'check-circle',
      variant: 'success',
    })
  );

  grid.appendChild(
    statCard({
      label: 'Ошибки',
      value: String(result.wrongCount),
      hint: result.wrongCount > 0 ? 'разобрать ниже' : 'ошибок нет',
      icon: 'x-circle',
      variant: result.wrongCount > 0 ? 'danger' : 'success',
    })
  );

  grid.appendChild(
    statCard({
      label: 'Пропущено',
      value: String(result.skippedCount),
      hint: result.skippedCount > 0 ? 'без ответа' : 'все отвечены',
      icon: 'help-circle',
      variant: result.skippedCount > 0 ? 'warning' : 'success',
    })
  );

  grid.appendChild(
    statCard({
      label: 'Процент',
      value: `${percent}%`,
      hint:
        percent >= 80
          ? 'отличный результат'
          : percent >= 50
            ? 'хороший результат'
            : 'стоит повторить тему',
      icon: 'pie-chart',
      variant: percent >= 80 ? 'success' : percent >= 50 ? 'warning' : 'danger',
    })
  );

  grid.appendChild(
    statCard({
      label: 'Трудокоины',
      value: `+${result.scorePoints}`,
      hint: result.pointsAwarded
        ? 'начислены на баланс'
        : 'начисление приостановлено',
      icon: 'award',
      variant: result.pointsAwarded ? 'success' : 'warning',
    })
  );

  if (result.timeSpentSec) {
    grid.appendChild(
      statCard({
        label: 'Время',
        value: formatDuration(result.timeSpentSec),
        hint: 'потрачено на тест',
        icon: 'clock',
        variant: 'info',
      })
    );
  }

  return grid;
}

interface StatCardOptions {
  label: string;
  value: string;
  hint?: string;
  icon: IconName;
  variant: 'success' | 'warning' | 'danger' | 'info' | 'primary' | 'lav';
}

function statCard(o: StatCardOptions): HTMLElement {
  return h(
    'div',
    { class: 'result-stat' },
    h(
      'div',
      { class: 'result-stat-head' },
      h('div', { class: 'result-stat-label' }, o.label),
      h(
        'div',
        { class: `result-stat-icon is-${o.variant}` },
        icon(o.icon, { size: 18, className: 'icon icon-sm' })
      )
    ),
    h('div', { class: 'result-stat-value' }, o.value),
    o.hint ? h('div', { class: 'result-stat-hint' }, o.hint) : null
  );
}

// ============================================================
// STATUS ALERT
// ============================================================

function renderStatusAlert(result: ResultData, percent: number): HTMLElement | null {
  if (result.status === 'blocked') {
    return alert(
      'danger',
      'shield-off',
      'Результат заблокирован',
      'Куратор проверит работу вручную. Трудокоины не начислены, но могут быть начислены после подтверждения. ' +
        'Если списывание не подтвердится — баллы вернутся.'
    );
  }

  if (result.status === 'flagged') {
    return alert(
      'warning',
      'flag',
      'Результат помечен для проверки',
      'Мы зафиксировали подозрительные сигналы во время прохождения. Трудокоины начислены, но куратор может пересмотреть результат.'
    );
  }

  if (percent >= 80) {
    return alert(
      'success',
      'star',
      'Отличная работа!',
      `Правильных ответов: ${result.correctCount} из ${result.totalCount}. Продолжайте в том же духе!`
    );
  }

  if (!result.pointsAwarded && result.scorePoints > 0) {
    return alert(
      'info',
      'info',
      'Трудокоины не начислены',
      'Повторное прохождение не оплачивается трудокоинами. Баллы можно получить за новые тесты.'
    );
  }

  return null;
}

function alert(
  variant: 'success' | 'warning' | 'danger' | 'info',
  iconName: IconName,
  title: string,
  body: string
): HTMLElement {
  return h(
    'div',
    { class: `result-alert is-${variant}` },
    h(
      'div',
      { class: 'result-alert-icon' },
      icon(iconName, { size: 22, className: 'icon icon-md' })
    ),
    h(
      'div',
      { style: 'min-width:0;' },
      h('div', { class: 'result-alert-title' }, title),
      h('div', { style: 'font-size: var(--fz-sm); line-height:1.55;' }, body)
    )
  );
}

// ============================================================
// REVIEW — фильтры + список
// ============================================================

function renderReview(result: ResultData): HTMLElement {
  let filter: FilterKey = 'all';

  const typeSummary = renderTypeSummary(result);
  const filtersHost = h('div', { class: 'result-filters' });
  const listHost = h('div');

  const wrongCount = result.questions.filter(
    (q) => q.isCorrect === false && q.userAnswer !== null && q.userAnswer !== undefined
  ).length;
  const skippedCount = result.questions.filter(
    (q) => q.userAnswer === null || q.userAnswer === undefined
  ).length;
  const correctCount = result.questions.filter((q) => q.isCorrect === true).length;

  function renderFilters(): void {
    clear(filtersHost);

    const items: Array<{ key: FilterKey; label: string; count: number }> = [
      { key: 'all', label: 'Все', count: result.questions.length },
      { key: 'wrong', label: 'Ошибки', count: wrongCount },
      { key: 'skipped', label: 'Пропущенные', count: skippedCount },
      { key: 'correct', label: 'Правильные', count: correctCount },
    ];

    for (const it of items) {
      if (it.key !== 'all' && it.count === 0) continue;
      filtersHost.appendChild(
        h(
          'button',
          {
            class: `result-chip ${filter === it.key ? 'is-active' : ''}`,
            type: 'button',
            onclick: () => {
              filter = it.key;
              renderFilters();
              renderList();
            },
          },
          it.label,
          h('span', { class: 'result-chip-count' }, String(it.count))
        )
      );
    }
  }

  function renderList(): void {
    clear(listHost);

    const visible = result.questions.filter((q) => {
      if (filter === 'all') return true;
      if (filter === 'wrong')
        return q.isCorrect === false && q.userAnswer !== null && q.userAnswer !== undefined;
      if (filter === 'skipped') return q.userAnswer === null || q.userAnswer === undefined;
      if (filter === 'correct') return q.isCorrect === true;
      return true;
    });

    if (visible.length === 0) {
      listHost.appendChild(
        emptyState({
          illustration: 'empty',
          title: 'Здесь пусто',
          description: 'По выбранному фильтру ничего не найдено.',
        })
      );
      return;
    }

    const list = h('div', { class: 'stagger' });
    result.questions.forEach((q, idx) => {
      if (!visible.includes(q)) return;
      list.appendChild(renderReviewCard(q, idx + 1));
    });
    listHost.appendChild(list);
  }

  renderFilters();
  renderList();

  return h(
    'div',
    { class: 'result-section' },
    h(
      'div',
      { class: 'result-section-head' },
      h('div', { class: 'result-section-title' }, 'Разбор ответов'),
      h(
        'a',
        {
          class: 'btn btn-ghost btn-sm',
          href: `#/app/test/${result.attemptId}`,
          style: 'display:none;',
        },
        'Повторить'
      )
    ),
    typeSummary,
    filtersHost,
    listHost
  );
}

// ============================================================
// Сводка по типам вопросов
// ============================================================

function renderTypeSummary(result: ResultData): HTMLElement {
  const byType = new Map<
    QuestionType,
    { total: number; correct: number; score: number; maxScore: number }
  >();

  for (const q of result.questions) {
    const row = byType.get(q.type) ?? {
      total: 0,
      correct: 0,
      score: 0,
      maxScore: 0,
    };
    row.total += 1;
    if (q.isCorrect === true) row.correct += 1;
    row.score += q.pointsEarned;
    row.maxScore += Math.max(q.pointsEarned, 5); // грубая верхняя граница
    byType.set(q.type, row);
  }

  const host = h('div', { class: 'result-type-summary' });

  for (const [type, row] of byType) {
    const meta = TYPE_LABELS[type];
    const pct = row.total > 0 ? (row.correct / row.total) * 100 : 0;
    const isWarn = pct < 60;

    const fill = h('div', {
      class: `result-type-row-bar-fill ${isWarn ? 'is-warn' : ''}`,
      style: `width: ${pct}%;`,
    });

    host.appendChild(
      h(
        'div',
        { class: 'result-type-row' },
        h(
          'div',
          { class: 'result-type-row-icon' },
          icon(meta.icon, { size: 18, className: 'icon icon-sm' })
        ),
        h(
          'div',
          { class: 'result-type-row-body' },
          h('div', { class: 'result-type-row-name' }, meta.label),
          h(
            'div',
            { class: 'result-type-row-meta' },
            `${row.correct} из ${row.total} · ${Math.round(pct)}%`
          ),
          h('div', { class: 'result-type-row-bar' }, fill)
        )
      )
    );
  }

  return host;
}

// ============================================================
// Карточка одного вопроса
// ============================================================

function renderReviewCard(q: ResultQuestion, index: number): HTMLElement {
  const isSkipped = q.userAnswer === null || q.userAnswer === undefined;
  const isCorrect = q.isCorrect === true;
  const isPartial = !isCorrect && !isSkipped && q.pointsEarned > 0;

  const state: 'correct' | 'wrong' | 'skipped' | 'partial' = isSkipped
    ? 'skipped'
    : isCorrect
      ? 'correct'
      : isPartial
        ? 'partial'
        : 'wrong';

  const statusText =
    state === 'correct'
      ? 'Верно'
      : state === 'wrong'
        ? 'Ошибка'
        : state === 'partial'
          ? 'Частично верно'
          : 'Пропущен';

  const statusIcon: IconName =
    state === 'correct'
      ? 'check'
      : state === 'wrong'
        ? 'x'
        : state === 'partial'
          ? 'minus'
          : 'help-circle';

  const meta = TYPE_LABELS[q.type];

  const head = h(
    'div',
    { class: 'result-review-head' },
    h(
      'div',
      { class: `result-review-number is-${state}` },
      String(index)
    ),
    h(
      'div',
      { class: `result-review-status is-${state}` },
      icon(statusIcon, { size: 12, className: 'icon icon-sm' }),
      statusText
    ),
    h(
      'div',
      { class: 'result-review-type' },
      icon(meta.icon, { size: 12, className: 'icon icon-sm' }),
      meta.label
    ),
    !isSkipped
      ? h(
          'div',
          {
            class: `result-review-points ${q.pointsEarned === 0 ? 'is-zero' : ''}`,
          },
          `+${q.pointsEarned}`
        )
      : h('div', { class: 'result-review-points is-zero' }, '0')
  );

  const card = h(
    'div',
    { class: `result-review is-${state}` },
    head,
    h('div', { class: 'result-review-text' }, q.text),
    q.imageUrl
      ? h('img', { class: 'result-review-image', src: q.imageUrl, alt: '' })
      : null
  );

  // Основное сравнение ответов
  card.appendChild(renderAnswerComparison(q, state));

  // Пояснение
  if (q.explanation) {
    card.appendChild(
      h(
        'div',
        { class: 'result-explanation' },
        h(
          'div',
          { class: 'result-explanation-icon' },
          icon('info', { size: 18, className: 'icon icon-sm' })
        ),
        h(
          'div',
          { style: 'min-width:0;' },
          h('div', { class: 'result-explanation-title' }, 'Пояснение'),
          h('div', { class: 'result-explanation-text' }, q.explanation)
        )
      )
    );
  }

  // Дополнительные детали (JSON payload) — на случай сложных типов
  if (hasDetails(q)) {
    card.appendChild(renderDetails(q));
  }

  return card;
}

// ============================================================
// Сравнение ответов — с учётом типа
// ============================================================

function renderAnswerComparison(
  q: ResultQuestion,
  state: 'correct' | 'wrong' | 'skipped' | 'partial'
): HTMLElement {
  // Пропущенный
  if (state === 'skipped') {
    return h(
      'div',
      { class: 'result-answers' },
      h(
        'div',
        { class: 'result-answer is-skipped' },
        h('span', { class: 'result-answer-label' }, 'Ваш ответ'),
        h('div', { class: 'result-answer-value' }, '— без ответа —')
      ),
      h(
        'div',
        { class: 'result-answer is-correct-answer' },
        h('span', { class: 'result-answer-label' }, 'Правильный ответ'),
        h('div', { class: 'result-answer-value' }, formatCorrect(q))
      )
    );
  }

  // Правильный
  if (state === 'correct') {
    return h(
      'div',
      { class: 'result-answers', style: 'grid-template-columns: 1fr;' },
      h(
        'div',
        { class: 'result-answer is-user-correct' },
        h('span', { class: 'result-answer-label' }, 'Ваш ответ'),
        h('div', { class: 'result-answer-value' }, formatUser(q))
      )
    );
  }

  // Неверный / частично верный — показываем оба
  return h(
    'div',
    { class: 'result-answers' },
    h(
      'div',
      { class: 'result-answer is-user-wrong' },
      h('span', { class: 'result-answer-label' }, 'Ваш ответ'),
      h('div', { class: 'result-answer-value' }, formatUser(q))
    ),
    h(
      'div',
      { class: 'result-answer is-correct-answer' },
      h('span', { class: 'result-answer-label' }, 'Правильный ответ'),
      h('div', { class: 'result-answer-value' }, formatCorrect(q))
    )
  );
}

// ============================================================
// Форматирование ответов по типам
// ============================================================

function formatUser(q: ResultQuestion): string | HTMLElement {
  const a = q.userAnswer;

  switch (q.type) {
    case 'input_number':
    case 'formula':
    case 'input_text':
      return String(a ?? '—');

    case 'single_choice': {
      const opt = findOption(q, String(a));
      return opt?.text ?? String(a ?? '—');
    }

    case 'multi_choice': {
      if (!Array.isArray(a)) return '—';
      const list = h('div', { class: 'result-answer-list' });
      const correctSet = new Set(
        Array.isArray(q.correctAnswer) ? (q.correctAnswer as string[]) : []
      );
      for (const id of a as string[]) {
        const opt = findOption(q, id);
        const ok = correctSet.has(id);
        list.appendChild(
          h(
            'div',
            { class: `result-answer-item ${ok ? 'is-ok' : 'is-bad'}` },
            opt?.text ?? id
          )
        );
      }
      return list;
    }

    case 'matching': {
      if (!a || typeof a !== 'object') return '—';
      const map = a as Record<string, string>;
      const correct = (q.correctAnswer as Record<string, string>) ?? {};
      const list = h('div', { class: 'result-answer-list' });
      for (const [left, right] of Object.entries(map)) {
        const ok = correct[left] === right;
        list.appendChild(
          h(
            'div',
            { class: `result-answer-item ${ok ? 'is-ok' : 'is-bad'}` },
            `${left} → ${right}`
          )
        );
      }
      return list;
    }

    case 'ordering': {
      if (!Array.isArray(a)) return '—';
      const userArr = a as number[];
      const correctArr = Array.isArray(q.correctAnswer)
        ? (q.correctAnswer as number[])
        : [];
      const list = h('div', { class: 'result-answer-list' });
      userArr.forEach((idx, position) => {
        const ok = correctArr[position] === idx;
        const label = getOrderingItemText(q, idx);
        list.appendChild(
          h(
            'div',
            { class: `result-answer-item ${ok ? 'is-ok' : 'is-bad'}` },
            `${position + 1}. ${label}`
          )
        );
      });
      return list;
    }

    default:
      return String(a ?? '—');
  }
}

function formatCorrect(q: ResultQuestion): string | HTMLElement {
  const c = q.correctAnswer;

  switch (q.type) {
    case 'input_number':
    case 'formula':
      return String(c ?? '—');

    case 'input_text': {
      if (Array.isArray(c)) return (c as string[]).join(' / ');
      return String(c ?? '—');
    }

    case 'single_choice': {
      const opt = findOption(q, String(c));
      return opt?.text ?? String(c ?? '—');
    }

    case 'multi_choice': {
      if (!Array.isArray(c)) return '—';
      const list = h('div', { class: 'result-answer-list' });
      for (const id of c as string[]) {
        const opt = findOption(q, id);
        list.appendChild(
          h('div', { class: 'result-answer-item is-ok' }, opt?.text ?? id)
        );
      }
      return list;
    }

    case 'matching': {
      if (!c || typeof c !== 'object') return '—';
      const map = c as Record<string, string>;
      const list = h('div', { class: 'result-answer-list' });
      for (const [left, right] of Object.entries(map)) {
        list.appendChild(
          h('div', { class: 'result-answer-item is-ok' }, `${left} → ${right}`)
        );
      }
      return list;
    }

    case 'ordering': {
      if (!Array.isArray(c)) return '—';
      const arr = c as number[];
      const list = h('div', { class: 'result-answer-list' });
      arr.forEach((idx, position) => {
        const label = getOrderingItemText(q, idx);
        list.appendChild(
          h('div', { class: 'result-answer-item is-ok' }, `${position + 1}. ${label}`)
        );
      });
      return list;
    }

    default:
      return String(c ?? '—');
  }
}

function findOption(
  q: ResultQuestion,
  id: string
): { id: string; text: string } | null {
  const options = (q as unknown as { payload?: { options?: Array<{ id: string; text: string }> } }).payload?.options;
  if (Array.isArray(options)) {
    return options.find((o) => o.id === id) ?? null;
  }
  return null;
}

function getOrderingItemText(q: ResultQuestion, index: number): string {
  const items = (q as unknown as { payload?: { items?: string[] } }).payload?.items;
  if (Array.isArray(items) && items[index] !== undefined) return items[index]!;
  return String(index);
}

function hasDetails(q: ResultQuestion): boolean {
  // Показываем раскрывающийся блок для matching / ordering — там обычно полезно
  // показать исходные данные.
  return q.type === 'matching' || q.type === 'ordering';
}

function renderDetails(q: ResultQuestion): HTMLElement {
  const details = h('details', { class: 'result-details' });
  details.appendChild(h('summary', null, 'Дополнительные детали'));

  const body = h('div', { class: 'result-details-body' });

  if (q.type === 'matching') {
    const left = (q as unknown as { payload?: { left?: string[] } }).payload?.left ?? [];
    const right = (q as unknown as { payload?: { right?: string[] } }).payload?.right ?? [];
    body.appendChild(
      h(
        'div',
        null,
        h('div', { style: 'font-weight:700;margin-bottom:6px;' }, 'Левый столбец'),
        h('div', null, left.join(' · '))
      )
    );
    body.appendChild(
      h(
        'div',
        { style: 'margin-top:10px;' },
        h('div', { style: 'font-weight:700;margin-bottom:6px;' }, 'Правый столбец'),
        h('div', null, right.join(' · '))
      )
    );
  } else if (q.type === 'ordering') {
    const items = (q as unknown as { payload?: { items?: string[] } }).payload?.items ?? [];
    body.appendChild(
      h(
        'div',
        null,
        h('div', { style: 'font-weight:700;margin-bottom:6px;' }, 'Исходный набор'),
        h('div', null, items.join(' · '))
      )
    );
  }

  details.appendChild(body);
  return details;
}

// ============================================================
// FOOTER ACTIONS
// ============================================================

function renderActions(result: ResultData): HTMLElement {
  const hasErrors =
    result.wrongCount > 0 || result.skippedCount > 0;

  return h(
    'div',
    { class: 'result-actions anim-slide-up' },
    h(
      'div',
      { class: 'result-actions-text' },
      h(
        'div',
        { class: 'result-actions-title' },
        hasErrors ? 'Разберите ошибки и попробуйте снова' : 'Отличный результат!'
      ),
      h(
        'div',
        { class: 'result-actions-sub' },
        hasErrors
          ? 'Разбор выше показывает правильные ответы и пояснения. А ещё можно заработать трудокоины на других тестах.'
          : 'Заработайте ещё трудокоины на других тестах или загляните в каталог подарков.'
      )
    ),
    h(
      'div',
      { class: 'result-actions-buttons' },
      h(
        'a',
        { class: 'btn', href: '#/app/subjects' },
        icon('book-open', { size: 18 }),
        'К дисциплинам'
      ),
      hasErrors
        ? h(
            'a',
            { class: 'btn btn-secondary', href: `#/app/test/${result.attemptId}` },
            icon('refresh-cw', { size: 18 }),
            'Пройти снова'
          )
        : null,
      h(
        'a',
        { class: 'btn btn-secondary', href: '#/app/catalog' },
        icon('gift', { size: 18 }),
        'В каталог'
      )
    )
  );
}

// ============================================================
// HELPERS
// ============================================================

async function refreshBalances(): Promise<void> {
  try {
    const res = await api.get<{
      children: Array<{
        id: string;
        fullName: string;
        birthDate: string;
        age: number;
        grade: number | null;
        balance: number;
      }>;
    }>('/me/children');
    store.setState({ children: res.children });
  } catch {
    // ignore
  }
}

// подавляем неиспользуемый импорт router
void router;