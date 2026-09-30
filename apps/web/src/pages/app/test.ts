// ============================================================
// pages/app/test.ts — движок прохождения теста
// Красивое оформление + 7 типов вопросов + анимации.
// ============================================================

import { h, mount, clear } from '../../lib/dom.js';
import { icon, type IconName } from '../../lib/icons.js';
import { api, isApiError } from '../../lib/api.js';
import { router } from '../../lib/router.js';
import { setRoot } from '../../components/layout.js';
import { openModal, confirmModal } from '../../lib/modal.js';
import { toastError, toastWarn } from '../../lib/toast.js';
import { formatTimer } from '../../lib/format.js';
import { store } from '../../lib/store.js';

type QuestionType =
  | 'input_number'
  | 'input_text'
  | 'single_choice'
  | 'multi_choice'
  | 'matching'
  | 'ordering'
  | 'formula';

interface Question {
  id: string;
  type: QuestionType;
  text: string;
  imageUrl: string | null;
  payload: Record<string, unknown>;
  orderIndex: number;
}

interface StartResponse {
  attemptId: string;
  testId: string;
  startedAt: string;
  timeLimitSec: number;
  questions: Question[];
}

interface AnswerState {
  answer: unknown;
  timeSpentMs: number;
  changesCount: number;
  answered: boolean;
}

const TYPE_META: Record<
  QuestionType,
  { label: string; icon: IconName; hint: string }
> = {
  input_number: {
    label: 'Число',
    icon: 'hash',
    hint: 'Введите число в поле ниже. Можно использовать точку или запятую.',
  },
  input_text: {
    label: 'Текст',
    icon: 'edit-2',
    hint: 'Введите текстовый ответ. Регистр не важен.',
  },
  formula: {
    label: 'Формула',
    icon: 'zap',
    hint: 'Введите выражение или результат. Например: 5^2, 5*5 или 25.',
  },
  single_choice: {
    label: 'Один вариант',
    icon: 'check-circle',
    hint: 'Выберите ровно один правильный вариант.',
  },
  multi_choice: {
    label: 'Несколько вариантов',
    icon: 'check-square',
    hint: 'Отметьте все правильные варианты. Ошибки снижают балл.',
  },
  matching: {
    label: 'Сопоставление',
    icon: 'link',
    hint: 'Подберите пару для каждого элемента слева.',
  },
  ordering: {
    label: 'Порядок',
    icon: 'list',
    hint: 'Расставьте элементы в правильном порядке. Можно стрелками.',
  },
};

// ============================================================
// ENTRY
// ============================================================

export async function renderAppTest(ctx: { params: { id: string } }): Promise<void> {
  const attemptId = ctx.params.id;

  const root = h('div');
  setRoot(root);
  mount(
    root,
    h(
      'div',
      { class: 'test-shell' },
      h(
        'div',
        { class: 'test-main center', style: 'min-height:80vh;' },
        h(
          'div',
          { class: 'test-finish' },
          h('div', { class: 'test-finish-spinner' }),
          h('div', { class: 'test-finish-title' }, 'Готовим вопросы...'),
          h('div', { class: 'test-finish-text' }, 'Загружаем тест и проверяем доступ')
        )
      )
    )
  );

  try {
    const res = await api.get<StartResponse>(`/attempts/${attemptId}/questions`);
    await runTest(attemptId, res);
  } catch (err) {
    if (isApiError(err)) {
      if (err.code === 'ATTEMPT_FINISHED') {
        router.navigate(`/app/result/${attemptId}`);
        return;
      }
      if (err.code === 'NOT_FOUND') {
        router.navigate('/app');
        return;
      }
    }

    mount(
      root,
      h(
        'div',
        { class: 'test-shell' },
        h(
          'div',
          { class: 'test-main center', style: 'min-height:80vh;' },
          h(
            'div',
            { class: 'test-finish' },
            h(
              'div',
              {
                class: 'test-success-icon-wrap',
                style: 'width:80px;height:80px;',
              },
              icon('alert-circle', { size: 40 })
            ),
            h('div', { class: 'test-finish-title' }, 'Не удалось загрузить тест'),
            h(
              'div',
              { class: 'test-finish-text' },
              isApiError(err) ? err.message : 'Попробуйте позже'
            ),
            h(
              'a',
              {
                class: 'btn mt-5',
                href: '#/app/subjects',
              },
              'К дисциплинам'
            )
          )
        )
      )
    );
  }
}

// ============================================================
// RUN
// ============================================================

async function runTest(attemptId: string, data: StartResponse): Promise<void> {
  const answers = new Map<string, AnswerState>();
  for (const q of data.questions) {
    answers.set(q.id, {
      answer: null,
      timeSpentMs: 0,
      changesCount: 0,
      answered: false,
    });
  }

  const startedAtMs = new Date(data.startedAt).getTime();
  const elapsedSec = Math.floor((Date.now() - startedAtMs) / 1000);
  let timeLeft = Math.max(0, data.timeLimitSec - elapsedSec);

  let currentIndex = 0;
  let questionStartedAt = Date.now();
  let finished = false;
  let focusLostCount = 0;
  let switching = false;

  const logEvent = (
    type: string,
    questionId?: string,
    meta?: Record<string, unknown>
  ): void => {
    void api
      .post(`/attempts/${attemptId}/event`, { type, questionId, meta })
      .catch(() => {});
  };

  // ---------- Антифрод-события ----------

  const onVisibility = (): void => {
    if (document.hidden && !finished) {
      focusLostCount += 1;
      logEvent('focus_lost', undefined, { count: focusLostCount });
      if (focusLostCount >= 3) {
        toastWarn('Не переключайтесь — это может повлиять на результат');
      }
    }
  };

  const onCopy = (e: Event): void => {
    e.preventDefault();
    logEvent('copy_paste', data.questions[currentIndex]?.id);
    toastWarn('Копирование запрещено');
  };

  const onPaste = (e: Event): void => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
      logEvent('paste_answer', data.questions[currentIndex]?.id);
    }
  };

  const onBeforeUnload = (e: BeforeUnloadEvent): void => {
    if (!finished) {
      e.preventDefault();
      e.returnValue = '';
    }
  };

  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('copy', onCopy);
  document.addEventListener('cut', onCopy);
  document.addEventListener('paste', onPaste);
  window.addEventListener('beforeunload', onBeforeUnload);

  const cleanup = (): void => {
    document.removeEventListener('visibilitychange', onVisibility);
    document.removeEventListener('copy', onCopy);
    document.removeEventListener('cut', onCopy);
    document.removeEventListener('paste', onPaste);
    window.removeEventListener('beforeunload', onBeforeUnload);
  };

  // ---------- Таймер ----------

  const timerEl = h(
    'div',
    { class: 'test-timer' },
    icon('clock', { size: 18 }),
    h('span', null, formatTimer(timeLeft))
  );

  function refreshTimer(): void {
    clear(timerEl);
    timerEl.appendChild(icon('clock', { size: 18 }));
    timerEl.appendChild(h('span', null, formatTimer(timeLeft)));
    timerEl.classList.toggle('is-warn', timeLeft <= 120 && timeLeft > 30);
    timerEl.classList.toggle('is-danger', timeLeft <= 30);
  }
  refreshTimer();

  const timerInterval = window.setInterval(() => {
    if (finished) return;
    timeLeft -= 1;
    refreshTimer();
    if (timeLeft <= 0) void finishTest('timeout');
  }, 1000);

  // ---------- Прогресс ----------

  const progressFill = h('div', {
    class: 'test-progress-fill',
    style: 'width: 0%;',
  });
  const progressParticles = h('div', { class: 'test-progress-particles' });
  const progressCount = h('div', { class: 'test-progress-count' });

  function updateProgress(): void {
    const total = data.questions.length;
    const answered = Array.from(answers.values()).filter((a) => a.answered).length;
    const pct = total > 0 ? (answered / total) * 100 : 0;
    progressFill.style.width = `${pct}%`;
    progressCount.textContent = `${answered} из ${total}`;
  }

  function burstParticles(): void {
    for (let i = 0; i < 6; i++) {
      const p = h('div', { class: 'test-progress-particle' });
      p.style.left = `${Math.random() * 100}%`;
      p.style.animationDelay = `${i * 30}ms`;
      progressParticles.appendChild(p);
      setTimeout(() => p.remove(), 1400);
    }
  }

  // ---------- Сохранение ответа ----------

  function saveCurrentAnswer(): void {
    const q = data.questions[currentIndex];
    if (!q) return;
    const state = answers.get(q.id)!;
    const timeSpent = Date.now() - questionStartedAt;
    state.timeSpentMs += timeSpent;
    questionStartedAt = Date.now();

    if (!state.answered) return;

    void api
      .patch(`/attempts/${attemptId}/answer`, {
        questionId: q.id,
        answer: state.answer,
        timeSpentMs: state.timeSpentMs,
        changesCount: state.changesCount,
      })
      .catch(() => {});
  }

  // ---------- Дом ----------

  const header = h(
    'header',
    { class: 'test-header', id: 'test-header' },
    h(
      'div',
      { class: 'test-header-inner' },
      h(
        'a',
        { class: 'test-header-brand', href: '#/app' },
        h('img', { src: '/logo.svg', alt: '' }),
        h('span', null, 'Тест')
      ),
      h('div', { class: 'grow' }),
      timerEl,
      h(
        'button',
        {
          class: 'test-abort-btn',
          type: 'button',
          onclick: () => void abortTest(),
        },
        icon('x', { size: 16, className: 'icon icon-sm' }),
        h('span', { class: 'hide-mobile' }, 'Прервать')
      )
    )
  );

  const progressEl = h(
    'div',
    { class: 'test-progress' },
    h(
      'div',
      { class: 'test-progress-head' },
      h('div', { class: 'test-progress-step' }, 'Прогресс'),
      progressCount
    ),
    h('div', { class: 'test-progress-track' }, progressFill, progressParticles)
  );

  const questionHost = h('div', { id: 'test-question-host' });

  const numbersEl = h(
    'div',
    { class: 'test-numbers' },
    h(
      'div',
      { class: 'test-numbers-head' },
      h('div', { class: 'test-numbers-label' }, 'Номера вопросов'),
      h(
        'div',
        { class: 'text-xs text-muted' },
        'Нажмите на номер, чтобы перейти'
      )
    )
  );
  const numbersList = h('div', { class: 'test-numbers-list' });
  numbersEl.appendChild(numbersList);

  function renderNumbers(): void {
    clear(numbersList);
    data.questions.forEach((q, i) => {
      const state = answers.get(q.id)!;
      const isCurrent = i === currentIndex;
      const isAnswered = state.answered && !isCurrent;
      const classes = ['test-number'];
      if (isCurrent) classes.push('is-current');
      else if (isAnswered) classes.push('is-answered');

      numbersList.appendChild(
        h(
          'button',
          {
            class: classes.join(' '),
            type: 'button',
            title: `Вопрос ${i + 1}`,
            onclick: () => goTo(i),
          },
          String(i + 1)
        )
      );
    });
  }

  // ---------- Переключение вопроса ----------

  function goTo(index: number): void {
    if (switching || finished) return;
    if (index < 0 || index >= data.questions.length) return;
    if (index === currentIndex) return;

    switching = true;
    saveCurrentAnswer();

    const currentCard = questionHost.querySelector('.test-question');
    if (currentCard) {
      currentCard.classList.add('is-leaving');
    }

    setTimeout(() => {
      currentIndex = index;
      questionStartedAt = Date.now();
      renderQuestion();
      switching = false;
    }, 240);
  }

  // ---------- Рендер вопроса ----------

  function renderQuestion(): void {
    const q = data.questions[currentIndex];
    if (!q) return;
    const state = answers.get(q.id)!;
    const meta = TYPE_META[q.type];

    const badge = h('div', { class: 'test-question-badge' }, String(currentIndex + 1));

    const typeBadge = h(
      'div',
      { class: 'test-question-type' },
      icon(meta.icon, { size: 12, className: 'icon icon-sm' }),
      meta.label
    );

    const counter = h(
      'div',
      { class: 'test-question-counter' },
      `из ${data.questions.length}`
    );

    const head = h(
      'div',
      { class: 'test-question-head' },
      badge,
      typeBadge,
      counter
    );

    const hint = h(
      'div',
      { class: 'test-type-hint' },
      h(
        'div',
        { class: 'test-type-hint-icon' },
        icon('info', { size: 16, className: 'icon icon-sm' })
      ),
      h('div', { class: 'test-type-hint-text' }, meta.hint)
    );

    const text = h('div', { class: 'test-question-text' }, q.text);

    const answerHost = h('div', { class: 'test-answer' });
    renderAnswerInput(answerHost, q, state, () => {
      const wasAnswered = state.answered;
      state.answered = true;
      state.changesCount += 1;
      updateProgress();
      renderNumbers();
      if (!wasAnswered) burstParticles();
    });

    const nav = h(
      'div',
      { class: 'test-question-nav' },
      h(
        'button',
        {
          class: 'btn btn-secondary btn-lg',
          type: 'button',
          disabled: currentIndex === 0,
          onclick: () => goTo(currentIndex - 1),
        },
        icon('arrow-left', { size: 20, className: 'icon icon-md' }),
        h('span', null, 'Назад')
      ),
      currentIndex < data.questions.length - 1
        ? h(
            'button',
            {
              class: 'btn btn-lg btn-primary-next',
              type: 'button',
              onclick: () => goTo(currentIndex + 1),
            },
            h('span', null, 'Далее'),
            icon('arrow-right', { size: 20, className: 'icon icon-md' })
          )
        : h(
            'button',
            {
              class: 'btn btn-success btn-lg btn-primary-next',
              type: 'button',
              onclick: () => void confirmFinish(),
            },
            h('span', null, 'Завершить'),
            icon('check', { size: 20, className: 'icon icon-md' })
          )
    );

    const card = h(
      'div',
      { class: 'test-question' },
      head,
      q.imageUrl
        ? h('img', { class: 'test-question-image', src: q.imageUrl, alt: '' })
        : null,
      text,
      hint,
      answerHost,
      nav
    );

    mount(questionHost, card);
    renderNumbers();

    // Автофокус на input для удобства
    setTimeout(() => {
      const input = answerHost.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        '.test-answer-input'
      );
      input?.focus();
    }, 300);
  }

  // ---------- Финальный экран ----------

  async function confirmFinish(): Promise<void> {
    const unanswered = Array.from(answers.values()).filter((a) => !a.answered).length;
    if (unanswered > 0) {
      const ok = await confirmModal({
        title: 'Завершить тест?',
        message: `Осталось ${unanswered} вопрос(ов) без ответа. Они будут засчитаны как ошибки.`,
        confirmLabel: 'Завершить',
      });
      if (!ok) return;
    }
    saveCurrentAnswer();
    await finishTest('completed');
  }

  async function abortTest(): Promise<void> {
    const ok = await confirmModal({
      title: 'Прервать тест?',
      message: 'Прогресс сохранится как «прерван». Баллы не начислятся.',
      confirmLabel: 'Прервать',
      danger: true,
    });
    if (!ok) return;

    finished = true;
    window.clearInterval(timerInterval);
    cleanup();

    await api
      .post(`/attempts/${attemptId}/finish`, { reason: 'manual' })
      .catch(() => {});

    router.navigate('/app');
  }

  async function finishTest(
    reason: 'completed' | 'timeout' | 'manual'
  ): Promise<void> {
    if (finished) return;
    finished = true;
    window.clearInterval(timerInterval);
    cleanup();

    // Финальный экран-лоадер
    mount(
      questionHost,
      h(
        'div',
        { class: 'test-finish' },
        h('div', { class: 'test-finish-spinner' }),
        h('div', { class: 'test-finish-title' }, 'Подводим итоги...'),
        h(
          'div',
          { class: 'test-finish-text' },
          'Считаем баллы и проверяем антифрод'
        )
      )
    );

    try {
      const res = await api.post<{
        attemptId: string;
        status: string;
        message?: string;
      }>(`/attempts/${attemptId}/finish`, { reason });

      showSuccessScreen(res.message, () => {
        router.navigate(`/app/result/${attemptId}`);
      });

      // Обновим баланс в store
      void refreshBalances();
    } catch (err) {
      toastError(isApiError(err) ? err.message : 'Не удалось завершить тест');
      router.navigate('/app');
    }
  }

  function showSuccessScreen(message: string | undefined, onContinue: () => void): void {
    const confettiHost = h('div', { class: 'test-success-confetti' });

    const card = h(
      'div',
      { class: 'test-success' },
      h(
        'div',
        { class: 'test-success-icon-wrap' },
        icon('check', { size: 60, className: 'icon' })
      ),
      h('div', { class: 'test-success-title' }, 'Тест завершён!'),
      h(
        'div',
        { class: 'test-success-text' },
        message ?? 'Результаты уже готовы. Посмотрим, что получилось?'
      ),
      h(
        'button',
        {
          class: 'btn btn-lg',
          type: 'button',
          onclick: onContinue,
        },
        h('span', null, 'К результату'),
        icon('arrow-right', { size: 20, className: 'icon icon-md' })
      )
    );

    mount(questionHost, card);
    document.body.appendChild(confettiHost);

    // Конфетти
    const colors = ['#247EE5', '#F7BF3F', '#27B56F', '#EC6A72', '#1BB8A2', '#7C4DFF'];
    for (let i = 0; i < 60; i++) {
      const piece = h('div', { class: 'test-confetti-piece' });
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.background = colors[Math.floor(Math.random() * colors.length)]!;
      piece.style.animationDuration = `${2.2 + Math.random() * 1.6}s`;
      piece.style.animationDelay = `${Math.random() * 0.8}s`;
      piece.style.setProperty('--drift', `${-80 + Math.random() * 160}px`);
      if (Math.random() > 0.5) piece.style.borderRadius = '50%';
      confettiHost.appendChild(piece);
    }

    setTimeout(() => confettiHost.remove(), 5000);

    // Автопереход через 2.5 сек, если не нажали
    setTimeout(() => {
      if (document.body.contains(card)) onContinue();
    }, 2500);
  }

  // ---------- Layout ----------

  const shell = h(
    'div',
    { class: 'test-shell' },
    header,
    h('main', { class: 'test-main' }, progressEl, questionHost, numbersEl)
  );

  setRoot(shell);

  // Тень шапки при скролле
  window.addEventListener(
    'scroll',
    () => {
      const hdr = document.getElementById('test-header');
      if (!hdr) return;
      if (window.scrollY > 8) hdr.classList.add('is-scrolled');
      else hdr.classList.remove('is-scrolled');
    },
    { passive: true }
  );

  renderQuestion();
  updateProgress();
}

// ============================================================
// Отрисовка полей ответа
// ============================================================

function renderAnswerInput(
  host: HTMLElement,
  q: Question,
  state: AnswerState,
  onChange: () => void
): void {
  clear(host);

  switch (q.type) {
    case 'input_number':
    case 'input_text':
    case 'formula': {
      const isNumber = q.type === 'input_number';
      const isFormula = q.type === 'formula';
      const placeholder =
        isNumber
          ? 'Введите число'
          : isFormula
            ? 'Например: 25 или 5*5'
            : 'Введите ответ';

      const input = h('input', {
        class: `test-answer-input ${!isNumber && !isFormula ? 'is-text' : ''}`,
        type: 'text',
        inputmode: isNumber ? 'decimal' : 'text',
        placeholder,
        value: state.answer !== null ? String(state.answer) : '',
        autocomplete: 'off',
        spellcheck: 'false',
      }) as HTMLInputElement;

      input.addEventListener('input', () => {
        state.answer = input.value;
        input.classList.toggle('is-filled', input.value.trim() !== '');
        onChange();
      });

      if (state.answer !== null && String(state.answer).trim() !== '') {
        input.classList.add('is-filled');
      }

      host.appendChild(h('div', { class: 'test-answer-input-wrap' }, input));
      break;
    }

    case 'single_choice': {
      const options =
        (q.payload.options as Array<{ id: string; text: string }>) ?? [];
      const selected = state.answer as string | null;

      const list = h('div', { class: 'test-choice-list' });

      options.forEach((opt) => {
        const isSelected = selected === opt.id;
        const label = h(
          'label',
          { class: `test-choice ${isSelected ? 'is-selected' : ''}` },
          h('input', {
            type: 'radio',
            name: `q-${q.id}`,
            checked: isSelected,
            style: 'position:absolute;opacity:0;pointer-events:none;',
            onchange: () => {
              state.answer = opt.id;
              onChange();
              renderAnswerInput(host, q, state, onChange);
            },
          }),
          h('span', { class: 'test-choice-marker' }, opt.id.toUpperCase()),
          h('span', { class: 'test-choice-text' }, opt.text)
        );
        list.appendChild(label);
      });

      host.appendChild(list);
      break;
    }

    case 'multi_choice': {
      const options =
        (q.payload.options as Array<{ id: string; text: string }>) ?? [];
      const selected = new Set<string>((state.answer as string[]) ?? []);

      const list = h('div', { class: 'test-choice-list' });

      options.forEach((opt) => {
        const isSelected = selected.has(opt.id);
        const label = h(
          'label',
          { class: `test-choice ${isSelected ? 'is-selected' : ''}` },
          h('input', {
            type: 'checkbox',
            checked: isSelected,
            style: 'position:absolute;opacity:0;pointer-events:none;',
            onchange: (e: Event) => {
              const checked = (e.target as HTMLInputElement).checked;
              if (checked) selected.add(opt.id);
              else selected.delete(opt.id);
              state.answer = Array.from(selected);
              onChange();
              renderAnswerInput(host, q, state, onChange);
            },
          }),
          h('span', { class: 'test-choice-marker' }, opt.id.toUpperCase()),
          h('span', { class: 'test-choice-text' }, opt.text)
        );
        list.appendChild(label);
      });

      host.appendChild(list);
      break;
    }

    case 'matching': {
      const left = (q.payload.left as string[]) ?? [];
      const right = (q.payload.right as string[]) ?? [];
      const current = (state.answer as Record<string, string>) ?? {};

      const wrap = h('div', { class: 'test-matching' });

      left.forEach((l) => {
        const select = h('select', {
          class: 'select',
        }) as HTMLSelectElement;
        select.appendChild(h('option', { value: '' }, '— выберите —'));
        for (const r of right) {
          select.appendChild(
            h('option', { value: r, selected: current[l] === r }, r)
          );
        }
        select.addEventListener('change', () => {
          current[l] = select.value;
          state.answer = { ...current };
          onChange();
        });

        wrap.appendChild(
          h(
            'div',
            { class: 'test-matching-row' },
            h('div', { class: 'test-matching-left' }, l),
            h(
              'div',
              { class: 'test-matching-arrow' },
              icon('arrow-right', { size: 16, className: 'icon icon-sm' })
            ),
            select
          )
        );
      });

      host.appendChild(wrap);
      break;
    }

    case 'ordering': {
      const items = (q.payload.items as string[]) ?? [];
      const order = (state.answer as number[]) ?? items.map((_, i) => i);

      const wrap = h('div', { class: 'test-ordering' });

      const rerender = (): void => {
        clear(wrap);
        order.forEach((itemIdx, position) => {
          const row = h(
            'div',
            { class: 'test-ordering-item' },
            h(
              'div',
              { class: 'test-ordering-grip', 'aria-hidden': 'true' },
              icon('more-vertical', { size: 16, className: 'icon icon-sm' })
            ),
            h('div', { class: 'test-ordering-number' }, String(position + 1)),
            h('div', { class: 'test-ordering-text' }, items[itemIdx] ?? ''),
            h(
              'div',
              { class: 'test-ordering-buttons' },
              h(
                'button',
                {
                  class: 'test-ordering-btn',
                  type: 'button',
                  title: 'Вверх',
                  disabled: position === 0,
                  onclick: (e: Event) => {
                    e.stopPropagation();
                    const arr = [...order];
                    const tmp = arr[position - 1]!;
                    arr[position - 1] = arr[position]!;
                    arr[position] = tmp;
                    state.answer = arr;
                    onChange();
                    rerender();
                  },
                },
                icon('chevron-up', { size: 16, className: 'icon icon-sm' })
              ),
              h(
                'button',
                {
                  class: 'test-ordering-btn',
                  type: 'button',
                  title: 'Вниз',
                  disabled: position === order.length - 1,
                  onclick: (e: Event) => {
                    e.stopPropagation();
                    const arr = [...order];
                    const tmp = arr[position + 1]!;
                    arr[position + 1] = arr[position]!;
                    arr[position] = tmp;
                    state.answer = arr;
                    onChange();
                    rerender();
                  },
                },
                icon('chevron-down', { size: 16, className: 'icon icon-sm' })
              )
            )
          );
          wrap.appendChild(row);
        });
      };

      // Инициализируем state, если ещё нет
      if (state.answer === null) {
        state.answer = items.map((_, i) => i);
      }

      rerender();
      host.appendChild(wrap);
      break;
    }

    default:
      host.appendChild(
        h('div', { class: 'alert alert-warning' }, 'Неизвестный тип вопроса')
      );
  }
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

// подавляем неиспользуемый импорт
void openModal;
void clear;