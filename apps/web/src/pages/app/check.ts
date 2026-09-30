// ============================================================
// pages/app/check.ts — kiosk-режим очной проверки
// Блокирует F12, Ctrl+Shift+I/J/C, Ctrl+U.
// ============================================================

import { h, mount } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { api, isApiError } from '../../lib/api.js';
import { router } from '../../lib/router.js';
import { setRoot } from '../../components/layout.js';
import { toastError, toastWarn } from '../../lib/toast.js';
import { formatTimer } from '../../lib/format.js';

interface SpotQuestion {
  id: string;
  type: string;
  text: string;
  imageUrl: string | null;
  payload: Record<string, unknown>;
  orderIndex: number;
}

interface SpotSession {
  spotCheckId: string;
  startedAt: string;
  timeLimitSec: number;
  questions: SpotQuestion[];
}

export async function renderAppCheck(ctx: { params: { id: string } }): Promise<void> {
  const spotCheckId = ctx.params.id;

  const root = h('div');
  setRoot(root);

  mount(root, h('div', { class: 'center', style: 'min-height:100vh;' },
    h('div', { class: 'text-center' },
      h('div', { class: 'loader-spinner', style: 'margin:0 auto 12px;' }),
      h('div', { class: 'text-muted text-sm' }, 'Готовим проверку...')
    )
  ));

  try {
    const session = await api.post<SpotSession>(`/spot-checks/${spotCheckId}/start`, {});
    runKiosk(session);
  } catch (err) {
    mount(root, h('div', { class: 'center', style: 'min-height:100vh;padding:24px;' },
      h('div', { class: 'card card-pad-lg text-center', style: 'max-width:480px;' },
        icon('alert-circle', { size: 48, className: 'icon icon-xl', style: 'color:var(--c-danger);margin:0 auto 12px;' }),
        h('h3', null, 'Не удалось запустить проверку'),
        h('p', { class: 'text-muted mt-2' }, isApiError(err) ? err.message : 'Обратитесь к куратору'),
        h('a', { class: 'btn mt-4', href: '#/app' }, 'В кабинет')
      )
    ));
  }
}

function runKiosk(session: SpotSession): void {
  const answers = new Map<string, { answer: unknown; timeSpentMs: number; answered: boolean }>();
  for (const q of session.questions) {
    answers.set(q.id, { answer: null, timeSpentMs: 0, answered: false });
  }

  let currentIndex = 0;
  let timeLeft = session.timeLimitSec;
  let questionStartedAt = Date.now();
  let finished = false;
  let focusWarnings = 0;

  const logEvent = (type: string, questionId?: string): void => {
    void api.post(`/spot-checks/${session.spotCheckId}/event`, { type, questionId }).catch(() => {});
  };

  const onVisibility = (): void => {
    if (document.hidden) {
      focusWarnings += 1;
      logEvent('focus_lost');
      toastWarn('Не покидайте окно проверки');
    }
  };

  const onBeforeUnload = (e: BeforeUnloadEvent): void => {
    if (!finished) {
      e.preventDefault();
      e.returnValue = '';
    }
  };

  const onKeydown = (e: KeyboardEvent): void => {
    // F12
    if (e.key === 'F12') {
      e.preventDefault();
      logEvent('devtools_open');
      toastWarn('Инструменты разработчика запрещены');
      return;
    }
    // Ctrl+Shift+I / J / C
    if (e.ctrlKey && e.shiftKey && ['I', 'J', 'C'].includes(e.key.toUpperCase())) {
      e.preventDefault();
      logEvent('devtools_open');
      toastWarn('Инструменты разработчика запрещены');
      return;
    }
    // Ctrl+U — view source
    if (e.ctrlKey && !e.shiftKey && e.key.toUpperCase() === 'U') {
      e.preventDefault();
      return;
    }
  };

  const onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
  };

  const onCopy = (e: Event): void => {
    e.preventDefault();
    logEvent('copy_paste');
    toastWarn('Копирование запрещено');
  };

  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('keydown', onKeydown);
  document.addEventListener('contextmenu', onContextMenu);
  document.addEventListener('copy', onCopy);
  document.addEventListener('cut', onCopy);
  window.addEventListener('beforeunload', onBeforeUnload);

  const cleanup = (): void => {
    document.removeEventListener('visibilitychange', onVisibility);
    document.removeEventListener('keydown', onKeydown);
    document.removeEventListener('contextmenu', onContextMenu);
    document.removeEventListener('copy', onCopy);
    document.removeEventListener('cut', onCopy);
    window.removeEventListener('beforeunload', onBeforeUnload);
  };

  const timerEl = h('div', { class: 'timer-badge', style: 'font-size:18px;' },
    icon('clock', { size: 20 }),
    h('span', null, formatTimer(timeLeft))
  );

  const timerInterval = window.setInterval(() => {
    if (finished) return;
    timeLeft -= 1;

    timerEl.replaceChildren(
      icon('clock', { size: 20 }),
      h('span', null, formatTimer(timeLeft))
    );

    if (timeLeft <= 30) timerEl.classList.add('is-danger');
    else timerEl.classList.remove('is-danger');

    if (timeLeft <= 0) void finishKiosk();
  }, 1000);

  const progressBar = h('div', { class: 'progress-bar', style: 'width:0%;' });

  function updateProgress(): void {
    const answered = Array.from(answers.values()).filter((a) => a.answered).length;
    const pct = (answered / session.questions.length) * 100;
    progressBar.style.width = `${pct}%`;
  }

  const questionHost = h('div');

  function saveCurrentAnswer(): void {
    const q = session.questions[currentIndex];
    if (!q) return;
    const state = answers.get(q.id)!;
    const timeSpent = Date.now() - questionStartedAt;
    state.timeSpentMs += timeSpent;
    questionStartedAt = Date.now();

    if (!state.answered) return;

    void api.patch(`/spot-checks/${session.spotCheckId}/answer`, {
      questionId: q.id,
      answer: state.answer,
      timeSpentMs: state.timeSpentMs,
    }).catch(() => {});
  }

  function renderQuestion(): void {
    const q = session.questions[currentIndex];
    if (!q) return;

    const state = answers.get(q.id)!;

    const header = h('div', { class: 'row-between mb-4' },
      h('div', { class: 'row gap-3' },
        h('div', { class: 'question-number' }, String(currentIndex + 1)),
        h('div', { class: 'text-sm text-muted' }, `из ${session.questions.length}`)
      ),
      timerEl
    );

    const body = h('div', null,
      h('h3', { style: 'line-height:1.4;font-size:22px;' }, q.text),
      q.imageUrl
        ? h('img', { src: q.imageUrl, alt: '', style: 'max-width:100%;border-radius:12px;margin-top:16px;' })
        : null
    );

    const inputHost = h('div', { class: 'mt-6' });
    renderKioskInput(inputHost, q, state, () => {
      state.answered = true;
      updateProgress();
    });

    const nav = h('div', { class: 'row-between mt-8' },
      h('button', {
        class: 'btn btn-secondary btn-lg',
        type: 'button',
        disabled: currentIndex === 0,
        onclick: () => {
          if (currentIndex === 0) return;
          saveCurrentAnswer();
          currentIndex -= 1;
          questionStartedAt = Date.now();
          renderQuestion();
        },
      }, icon('arrow-left', { size: 20 }), 'Назад'),
      currentIndex < session.questions.length - 1
        ? h('button', {
            class: 'btn btn-lg',
            type: 'button',
            onclick: () => {
              saveCurrentAnswer();
              currentIndex += 1;
              questionStartedAt = Date.now();
              renderQuestion();
            },
          }, 'Далее', icon('arrow-right', { size: 20 }))
        : h('button', {
            class: 'btn btn-success btn-lg',
            type: 'button',
            onclick: async () => {
              saveCurrentAnswer();
              await finishKiosk();
            },
          }, 'Завершить', icon('check', { size: 20 }))
    );

    mount(questionHost,
      h('div', { class: 'question-block', style: 'padding:28px;' }, header, body, inputHost),
      nav
    );
  }

  async function finishKiosk(): Promise<void> {
    if (finished) return;
    finished = true;
    window.clearInterval(timerInterval);
    cleanup();

    mount(questionHost, h('div', { class: 'center', style: 'padding:64px 0;' },
      h('div', { class: 'text-center' },
        h('div', { class: 'loader-spinner', style: 'margin:0 auto 16px;' }),
        h('div', { class: 'text-muted' }, 'Сохраняем результаты...')
      )
    ));

    try {
      await api.post(`/spot-checks/${session.spotCheckId}/finish`, { reason: 'completed' });
      mount(questionHost, h('div', { class: 'center', style: 'padding:64px 0;' },
        h('div', { class: 'text-center', style: 'max-width:420px;' },
          h('div', {
            class: 'center',
            style: 'width:80px;height:80px;border-radius:50%;background:var(--c-success);color:#fff;margin:0 auto 16px;',
          }, icon('check', { size: 40 })),
          h('h3', null, 'Проверка завершена'),
          h('p', { class: 'text-muted mt-2' }, 'Спасибо! Результаты переданы куратору.'),
          h('a', { class: 'btn mt-6', href: '#/app' }, 'В личный кабинет')
        )
      ));
    } catch (err) {
      toastError(isApiError(err) ? err.message : 'Не удалось завершить');
      router.navigate('/app');
    }
  }

  const layout = h('div', { class: 'app-shell', style: 'background:var(--c-surface);' },
    h('header', { class: 'app-header' },
      h('div', { class: 'app-header-inner' },
        h('div', { class: 'public-logo' },
          h('img', { src: '/logo.svg', alt: '' }),
          h('span', { class: 'hide-mobile' }, 'Очная проверка')
        ),
        h('div', { class: 'grow' }),
        h('span', { class: 'badge badge-warn' },
          icon('shield', { size: 12, className: 'icon icon-sm' }),
          'Kiosk-режим'
        )
      )
    ),
    h('main', { class: 'app-main', style: 'max-width:820px;' },
      h('div', { class: 'progress progress-thin mb-6' }, progressBar),
      h('div', { class: 'alert alert-info mb-6' },
        icon('info', { size: 18, className: 'icon icon-sm alert-icon' }),
        h('div', null,
          h('div', { class: 'alert-title' }, 'Не покидайте страницу'),
          'Все события фиксируются. Время ограничено.'
        )
      ),
      questionHost
    )
  );

  setRoot(layout);
  renderQuestion();
  updateProgress();
}

function renderKioskInput(
  host: HTMLElement,
  q: SpotQuestion,
  state: { answer: unknown; answered: boolean },
  onChange: () => void
): void {
  switch (q.type) {
    case 'input_number':
    case 'input_text':
    case 'formula': {
      const input = h('input', {
        class: 'input',
        type: 'text',
        inputmode: q.type === 'input_number' ? 'decimal' : 'text',
        placeholder: 'Введите ответ',
        value: state.answer !== null ? String(state.answer) : '',
        style: 'font-size:24px;padding:18px;text-align:center;font-family:var(--font-mono);',
      }) as HTMLInputElement;

      input.addEventListener('input', () => {
        state.answer = input.value;
        onChange();
      });

      setTimeout(() => input.focus(), 100);
      mount(host, input);
      break;
    }

    case 'single_choice': {
      const options = (q.payload.options as Array<{ id: string; text: string }>) ?? [];
      const selected = state.answer as string | null;

      mount(host,
        h('div', { class: 'stack' },
          ...options.map((opt) =>
            h('label', {
              class: 'check check-radio card card-pad-lg',
              style: `cursor:pointer;font-size:18px;${selected === opt.id ? 'border-color:var(--c-primary);background:var(--c-primary-100);' : ''}`,
            },
              h('input', {
                type: 'radio',
                name: `kq-${q.id}`,
                checked: selected === opt.id,
                onchange: () => {
                  state.answer = opt.id;
                  onChange();
                  renderKioskInput(host, q, state, onChange);
                },
              }),
              h('span', { class: 'check-box' }),
              h('span', { class: 'grow fw-600' }, opt.text)
            )
          )
        )
      );
      break;
    }

    case 'multi_choice': {
      const options = (q.payload.options as Array<{ id: string; text: string }>) ?? [];
      const selected = new Set<string>((state.answer as string[]) ?? []);

      mount(host,
        h('div', { class: 'stack' },
          ...options.map((opt) =>
            h('label', {
              class: 'check card card-pad-lg',
              style: `cursor:pointer;font-size:18px;${selected.has(opt.id) ? 'border-color:var(--c-primary);background:var(--c-primary-100);' : ''}`,
            },
              h('input', {
                type: 'checkbox',
                checked: selected.has(opt.id),
                onchange: (e: Event) => {
                  const checked = (e.target as HTMLInputElement).checked;
                  if (checked) selected.add(opt.id);
                  else selected.delete(opt.id);
                  state.answer = Array.from(selected);
                  onChange();
                  renderKioskInput(host, q, state, onChange);
                },
              }),
              h('span', { class: 'check-box' }),
              h('span', { class: 'grow fw-600' }, opt.text)
            )
          )
        )
      );
      break;
    }

    default:
      mount(host, h('div', { class: 'alert alert-warn' }, 'Тип вопроса не поддерживается в kiosk-режиме'));
  }
}