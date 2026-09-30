// ============================================================
// pages/admin/test-edit.ts — конструктор теста
// Модалка «Добавить вопросы» использует actions openModal.
// Нет window.__qtPayload, нет document.querySelector('.modal-foot').
// ============================================================

import { h, mount, clear } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { api, isApiError } from '../../lib/api.js';
import { router } from '../../lib/router.js';
import { adminLayout, setRoot, backLink } from '../../components/layout.js';
import { emptyState, loader, statusBadge } from '../../components/ui.js';
import { openModal, confirmModal } from '../../lib/modal.js';
import { toastSuccess, toastError } from '../../lib/toast.js';
import { formatDuration } from '../../lib/format.js';
import { openQuestionModal } from './questions.js';

interface AdminTest {
  id: string;
  subjectId: string;
  title: string;
  description: string | null;
  status: string;
  version: number;
  timeLimitSec: number;
  gradeMin: number | null;
  gradeMax: number | null;
  ageMin: number | null;
  ageMax: number | null;
  pointsFixed: number;
  pointsPerCorrect: number;
  pointsPenaltyWrong: number;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  allowRetake: boolean;
  rewardOnRetake: boolean;
  questionsCount: number;
  publishedAt: string | null;
  updatedAt: string;
  questions?: QuestionInTest[];
}

interface QuestionInTest {
  id: string;
  type: string;
  text: string;
  orderIndex: number;
  pointsOverride: number | null;
}

interface SubjectItem {
  id: string;
  title: string;
}

interface QuestionTypeSetting {
  type: string;
  title: string;
  description: string | null;
  icon: string | null;
  isEnabled: boolean;
  defaultPoints: number;
  minOptions: number | null;
  maxOptions: number | null;
  requiresImage: boolean;
  sortOrder: number;
  allowedRoles: string[];
}

interface BankQuestion {
  id: string;
  type: string;
  text: string;
  subjectId: string;
}

interface PayloadCollector {
  value: Record<string, unknown>;
  valid: boolean;
  error?: string;
}

export async function renderAdminTestEdit(ctx: { params: { id: string } }): Promise<void> {
  const testId = ctx.params.id;

  const root = h('div');
  setRoot(adminLayout({
    active: 'tests',
    title: 'Редактор теста',
    content: root,
  }));
  mount(root, loader());

  try {
    const [testRes, subjectsRes] = await Promise.all([
      api.get<{ test: AdminTest & { questions: QuestionInTest[] } }>(
        `/tests/admin/${testId}/full`
      ),
      api.get<{ items: SubjectItem[] }>('/subjects?active=1&limit=200'),
    ]);

    const test = testRes.test;
    const subject = subjectsRes.items.find((s) => s.id === test.subjectId);

    const content = h('div', { class: 'stack-lg' },
      h('div', { class: 'row-between row-wrap gap-3 anim-slide-up' },
        backLink('Все тесты', '#/admin/tests'),
        h('div', { class: 'row gap-2 row-wrap' },
          test.status === 'draft' && h('button', {
            class: 'btn btn-secondary',
            type: 'button',
            onclick: async () => {
              if (test.questionsCount === 0) {
                toastError('Сначала добавьте вопросы в тест');
                return;
              }
              const ok = await confirmModal({
                title: 'Отправить на проверку?',
                message: 'Тест станет доступен для публикации.',
                confirmLabel: 'Отправить',
              });
              if (!ok) return;
              try {
                await api.post(`/tests/admin/${test.id}/publish`, { status: 'review' });
                toastSuccess('Отправлено');
                router.reload();
              } catch (err) {
                toastError(isApiError(err) ? err.message : 'Ошибка');
              }
            },
          }, 'На проверку'),

          test.status !== 'published' && h('button', {
            class: 'btn btn-success',
            type: 'button',
            disabled: test.questionsCount === 0,
            onclick: async () => {
              if (test.questionsCount === 0) {
                toastError('Сначала добавьте вопросы в тест');
                return;
              }
              try {
                await api.post(`/tests/admin/${test.id}/publish`, { status: 'published' });
                toastSuccess('Тест опубликован');
                router.reload();
              } catch (err) {
                toastError(isApiError(err) ? err.message : 'Ошибка');
              }
            },
          },
            icon('check', { size: 18 }),
            'Опубликовать'
          ),

          test.status === 'published' && h('button', {
            class: 'btn btn-secondary',
            type: 'button',
            onclick: async () => {
              try {
                await api.post(`/tests/admin/${test.id}/publish`, { status: 'archived' });
                toastSuccess('В архив');
                router.reload();
              } catch (err) {
                toastError(isApiError(err) ? err.message : 'Ошибка');
              }
            },
          }, 'В архив'),

          h('button', {
            class: 'btn btn-secondary',
            type: 'button',
            onclick: async () => {
              try {
                const cloned = await api.post<{ test: { id: string } }>(
                  `/tests/admin/${test.id}/clone`,
                  {}
                );
                toastSuccess('Копия создана');
                router.navigate(`/admin/tests/${cloned.test.id}`);
              } catch (err) {
                toastError(isApiError(err) ? err.message : 'Ошибка');
              }
            },
          },
            icon('copy', { size: 18 }),
            'Копия'
          ),

          test.status !== 'published' && h('button', {
            class: 'btn btn-danger',
            type: 'button',
            onclick: async () => {
              const ok = await confirmModal({
                title: 'Удалить тест?',
                message: 'Действие необратимо.',
                confirmLabel: 'Удалить',
                danger: true,
              });
              if (!ok) return;
              try {
                await api.delete(`/tests/admin/${test.id}`);
                toastSuccess('Удалено');
                router.navigate('/admin/tests');
              } catch (err) {
                toastError(isApiError(err) ? err.message : 'Ошибка');
              }
            },
          },
            icon('trash-2', { size: 18 }),
            'Удалить'
          )
        )
      ),

      test.questionsCount === 0 && test.status !== 'published'
        ? h('div', { class: 'alert alert-warning anim-slide-up' },
            icon('alert-triangle', { size: 18, className: 'icon icon-sm alert-icon' }),
            h('div', null,
              h('div', { class: 'alert-title' }, 'Тест пока пустой'),
              'Добавьте хотя бы один вопрос, чтобы можно было опубликовать тест и открыть его для учеников.'
            )
          )
        : null,

      h('div', { class: 'card card-pad-lg anim-slide-up delay-1' },
        h('div', { class: 'row-between row-wrap gap-3' },
          h('div', { style: 'min-width: 0;' },
            h('h2', { style: 'font-size: var(--fz-2xl);' }, test.title),
            subject ? h('div', { class: 'text-sm text-muted mt-1' }, subject.title) : null
          ),
          h('div', { class: 'row gap-2 row-wrap' },
            statusBadge(test.status),
            h('span', { class: 'badge' }, `v${test.version}`)
          )
        ),
        test.description ? h('p', { class: 'text-muted mt-3' }, test.description) : null,
        h('div', { class: 'row row-wrap gap-2 mt-5' },
          metaChip('file-text', `${test.questionsCount} вопросов`),
          metaChip('clock', formatDuration(test.timeLimitSec)),
          metaChip('award', `${test.pointsFixed} + ${test.pointsPerCorrect}/верн.`),
          test.gradeMin && test.gradeMax
            ? metaChip('users', `Классы ${test.gradeMin}–${test.gradeMax}`)
            : null
        ),
        h('div', { class: 'row gap-2 mt-5' },
          h('button', {
            class: 'btn btn-secondary btn-sm',
            type: 'button',
            disabled: test.status === 'published',
            onclick: () => openMetaEditModal(test, () => router.reload()),
          },
            icon('edit-2', { size: 16, className: 'icon icon-sm' }),
            'Метаданные'
          )
        )
      ),

      h('div', { class: 'anim-slide-up delay-2' },
        h('div', { class: 'row-between row-wrap gap-3 mb-4' },
          h('h3', null, 'Вопросы'),
          h('button', {
            class: 'btn',
            type: 'button',
            disabled: test.status === 'published',
            onclick: () => void openAttachQuestionsModal(test, subject?.title ?? '', () => router.reload()),
          },
            icon('plus', { size: 18 }),
            'Добавить вопросы'
          )
        ),
        test.status === 'published'
          ? h('div', { class: 'alert alert-warning mb-4' },
              icon('alert-triangle', { size: 18, className: 'icon icon-sm alert-icon' }),
              'Опубликованный тест нельзя редактировать. Создайте копию.'
            )
          : null,
        renderQuestions(test, subject?.title ?? '')
      )
    );

    mount(root, content);
  } catch (err) {
    mount(root, emptyState({
      illustration: 'error',
      title: 'Не удалось загрузить тест',
      description: isApiError(err) ? err.message : 'Попробуйте позже',
    }));
  }
}

function metaChip(iconName: string, text: string): HTMLElement {
  return h('span', { class: 'badge' },
    icon(iconName as never, { size: 12, className: 'icon icon-sm' }),
    text
  );
}

function renderQuestions(
  test: AdminTest & { questions: QuestionInTest[] },
  subjectTitle: string
): HTMLElement {
  const questions = [...test.questions].sort((a, b) => a.orderIndex - b.orderIndex);

  if (questions.length === 0) {
    return emptyState({
      illustration: 'empty',
      title: 'Вопросов пока нет',
      description: 'Добавьте вопросы из банка или создайте новые прямо здесь.',
      action: h('button', {
        class: 'btn',
        type: 'button',
        onclick: () => void openAttachQuestionsModal(test, subjectTitle, () => router.reload()),
      },
        icon('plus', { size: 18 }),
        'Добавить вопросы'
      ),
    });
  }

  return h('div', { class: 'stack-sm stagger' },
    ...questions.map((q, idx) =>
      h('div', { class: 'card card-pad stagger-item' },
        h('div', { class: 'row-between row-wrap gap-3', style: 'align-items: flex-start;' },
          h('div', { class: 'row gap-3 grow', style: 'min-width: 0;' },
            h('div', { class: 'question-number' }, String(idx + 1)),
            h('div', { class: 'grow', style: 'min-width: 0;' },
              h('div', { class: 'text-xs text-muted' }, q.type),
              h('div', { class: 'fw-600 mt-1', style: 'line-height: 1.4;' }, q.text)
            )
          ),
          h('div', { class: 'row gap-1' },
            h('button', {
              class: 'btn btn-ghost btn-icon btn-sm',
              type: 'button',
              disabled: test.status === 'published',
              onclick: () => void openQuestionModal(q.id, () => router.reload()),
              title: 'Редактировать',
            }, icon('edit-2', { size: 16, className: 'icon icon-sm' })),
            h('button', {
              class: 'btn btn-ghost btn-icon btn-sm',
              type: 'button',
              disabled: test.status === 'published',
              onclick: async () => {
                const ok = await confirmModal({
                  title: 'Убрать вопрос из теста?',
                  message: 'Вопрос останется в банке.',
                  confirmLabel: 'Убрать',
                  danger: true,
                });
                if (!ok) return;
                const newItems = questions
                  .filter((x) => x.id !== q.id)
                  .map((x, i) => ({
                    questionId: x.id,
                    orderIndex: i,
                    pointsOverride: x.pointsOverride ?? undefined,
                  }));
                try {
                  await api.post(`/tests/admin/${test.id}/questions`, { items: newItems });
                  toastSuccess('Убрано');
                  router.reload();
                } catch (err) {
                  toastError(isApiError(err) ? err.message : 'Ошибка');
                }
              },
              title: 'Убрать',
            }, icon('x', { size: 16, className: 'icon icon-sm' }))
          )
        )
      )
    )
  );
}

// ============================================================
// МОДАЛКА «ДОБАВИТЬ ВОПРОСЫ» — actions в openModal
// ============================================================

async function openAttachQuestionsModal(
  test: AdminTest & { questions: QuestionInTest[] },
  subjectTitle: string,
  onSuccess: () => void
): Promise<void> {
  const content = h('div', { class: 'stack' }, loader());

  const selected = new Set<string>();
  let activeTab: 'bank' | 'constructor' = 'bank';
  let typeSettings: QuestionTypeSetting[] = [];
  let bankItems: BankQuestion[] = [];

  let submitHandler: (() => Promise<boolean>) | null = null;
  let submitDisabled = true;

  const close = openModal({
    title: 'Добавить вопросы',
    body: content,
    size: 'xl',
    actions: [
      {
        label: 'Отмена',
        variant: 'secondary',
        onClick: () => true,
      },
      {
        label: 'Добавить в тест',
        variant: 'primary',
        closeOnClick: false,
        onClick: async () => {
          if (activeTab === 'constructor' || !submitHandler) {
            return false;
          }
          if (submitDisabled) {
            toastError('Выберите хотя бы один вопрос');
            return false;
          }
          const ok = await submitHandler();
          if (ok) close();
          return false;
        },
      },
    ],
  });

  const renderContent = async (): Promise<void> => {
    try {
      const [bankRes, settingsRes] = await Promise.all([
        api.get<{ items: BankQuestion[] }>(
          `/questions?subjectId=${encodeURIComponent(test.subjectId)}&limit=200&active=1`
        ),
        api.get<{ items: QuestionTypeSetting[] }>('/questions/type-settings/enabled'),
      ]);

      bankItems = bankRes.items;
      typeSettings = settingsRes.items;

      const existingIds = new Set(test.questions.map((q) => q.id));
      const available = bankItems.filter((q) => !existingIds.has(q.id));

      const tabs = h('div', { class: 'qt-constructor-tabs' },
        h('button', {
          class: `qt-constructor-tab ${activeTab === 'bank' ? 'is-active' : ''}`,
          type: 'button',
          onclick: () => { activeTab = 'bank'; void renderContent(); },
        },
          icon('layers', { size: 16, className: 'icon icon-sm' }),
          `Из банка (${available.length})`
        ),
        h('button', {
          class: `qt-constructor-tab ${activeTab === 'constructor' ? 'is-active' : ''}`,
          type: 'button',
          onclick: () => { activeTab = 'constructor'; void renderContent(); },
        },
          icon('plus-circle', { size: 16, className: 'icon icon-sm' }),
          'Новый вопрос'
        )
      );

      const bodyHost = h('div', { class: 'qt-constructor-body' });

      clear(content);
      content.appendChild(h('div', { class: 'qt-constructor' }, tabs, bodyHost));

      if (activeTab === 'bank') {
        submitDisabled = selected.size === 0;
        renderBankTab(bodyHost, available, subjectTitle, selected, (count) => {
          submitDisabled = count === 0;
        });
        submitHandler = async (): Promise<boolean> => {
          const items = [
            ...test.questions.map((q, i) => ({
              questionId: q.id,
              orderIndex: i,
              pointsOverride: q.pointsOverride ?? undefined,
            })),
            ...[...selected].map((qid, i) => ({
              questionId: qid,
              orderIndex: test.questions.length + i,
            })),
          ];
          try {
            await api.post(`/tests/admin/${test.id}/questions`, { items });
            toastSuccess('Вопросы добавлены');
            onSuccess();
            return true;
          } catch (err) {
            toastError(isApiError(err) ? err.message : 'Ошибка');
            return false;
          }
        };
      } else {
        renderConstructorTab(bodyHost, test, typeSettings, onSuccess, close);
        submitHandler = null;
        submitDisabled = true;
      }
    } catch (err) {
      clear(content);
      content.appendChild(
        h('div', { class: 'alert alert-danger' },
          isApiError(err) ? err.message : 'Не удалось загрузить данные'
        )
      );
    }
  };

  await renderContent();
}

function renderBankTab(
  host: HTMLElement,
  available: BankQuestion[],
  subjectTitle: string,
  selected: Set<string>,
  onSelectionChange: (count: number) => void
): void {
  if (available.length === 0) {
    mount(host,
      h('div', { class: 'qt-empty' },
        h('div', { class: 'qt-empty-icon' }, icon('inbox', { size: 40 })),
        h('div', { class: 'qt-empty-title' }, 'В банке нет свободных вопросов'),
        h('div', { class: 'qt-empty-text' },
          `В дисциплине «${subjectTitle}» пока нет вопросов, которых ещё нет в тесте. Переключитесь на вкладку «Новый вопрос», чтобы создать его.`
        )
      )
    );
    return;
  }

  const list = h('div', { class: 'qt-bank-list' });

  for (const q of available) {
    const checkbox = h('input', {
      type: 'checkbox',
      checked: selected.has(q.id),
      onchange: (e: Event) => {
        if ((e.target as HTMLInputElement).checked) selected.add(q.id);
        else selected.delete(q.id);
        onSelectionChange(selected.size);
      },
    }) as HTMLInputElement;

    list.appendChild(
      h('label', { class: 'qt-bank-item' },
        checkbox,
        h('span', { class: 'check-box' }),
        h('div', { class: 'qt-bank-content' },
          h('div', { class: 'qt-bank-type' }, q.type),
          h('div', { class: 'qt-bank-text' }, q.text)
        )
      )
    );
  }

  mount(host, list);
}

function renderConstructorTab(
  host: HTMLElement,
  test: AdminTest & { questions: QuestionInTest[] },
  typeSettings: QuestionTypeSetting[],
  onSuccess: () => void,
  close: () => void
): void {
  if (typeSettings.length === 0) {
    mount(host,
      h('div', { class: 'qt-empty' },
        h('div', { class: 'qt-empty-icon' }, icon('alert-circle', { size: 40 })),
        h('div', { class: 'qt-empty-title' }, 'Типы вопросов отключены'),
        h('div', { class: 'qt-empty-text' },
          'Все типы вопросов выключены в справочнике. Включите хотя бы один в разделе «Типы вопросов» админки.'
        ),
        h('a', {
          class: 'btn btn-secondary btn-sm mt-4',
          href: '#/admin/question-types',
          onclick: () => close(),
        }, 'Перейти к типам')
      )
    );
    return;
  }

  let currentType: string = typeSettings[0]!.type;

  const typeSelect = h('select', { class: 'select' }) as HTMLSelectElement;
  for (const s of typeSettings) {
    typeSelect.appendChild(h('option', {
      value: s.type,
      selected: s.type === currentType,
    }, s.title));
  }

  const textInput = h('textarea', {
    class: 'textarea',
    placeholder: 'Текст вопроса. Например: «Сколько будет 25 + 17?»',
    rows: '3',
  }) as HTMLTextAreaElement;

  const explanationInput = h('textarea', {
    class: 'textarea',
    placeholder: 'Пояснение к правильному ответу (необязательно)',
    rows: '2',
  }) as HTMLTextAreaElement;

  const difficultyInput = h('input', {
    class: 'input',
    type: 'number',
    min: '1',
    max: '5',
    value: '2',
  }) as HTMLInputElement;

  const tagsInput = h('input', {
    class: 'input',
    placeholder: 'через запятую, необязательно',
  }) as HTMLInputElement;

  const payloadHost = h('div', { class: 'qt-payload-host' });
  let payloadCollector: (() => PayloadCollector) | null = null;

  const currentSetting = (): QuestionTypeSetting | undefined =>
    typeSettings.find((s) => s.type === currentType);

  const renderPayload = (): void => {
    clear(payloadHost);
    payloadCollector = renderPayloadFor(currentType, currentSetting(), null, payloadHost);
  };

  typeSelect.addEventListener('change', () => {
    currentType = typeSelect.value;
    renderPayload();
    updateHint();
  });

  const typeField = h('div', { class: 'qt-field' },
    h('label', { class: 'qt-field-label' }, 'Тип вопроса'),
    typeSelect
  );

  const typeHint = h('div', { class: 'qt-type-hint' });

  const updateHint = (): void => {
    const s = currentSetting();
    if (!s) {
      clear(typeHint);
      return;
    }
    mount(typeHint,
      h('div', { class: 'qt-type-hint-icon' },
        icon((s.icon as never) ?? 'help-circle', { size: 16, className: 'icon icon-sm' })
      ),
      h('div', null,
        s.description ? h('div', { class: 'qt-type-hint-text' }, s.description) : null,
        h('div', { class: 'qt-type-hint-meta' },
          `По умолчанию: ${s.defaultPoints} балл.`,
          s.minOptions !== null || s.maxOptions !== null
            ? ` · Вариантов: ${s.minOptions ?? 0}–${s.maxOptions ?? '∞'}`
            : '',
          s.requiresImage ? ' · Обязательна картинка' : ''
        )
      )
    );
  };

  const body = h('div', { class: 'qt-constructor-form' },
    h('div', { class: 'qt-form-grid-2' },
      typeField,
      h('div', { class: 'qt-field' },
        h('label', { class: 'qt-field-label' }, 'Сложность (1–5)'),
        difficultyInput
      )
    ),
    typeHint,
    h('div', { class: 'qt-field' },
      h('label', { class: 'qt-field-label' }, 'Текст вопроса ', h('span', { class: 'req' }, '*')),
      textInput
    ),
    h('div', { class: 'qt-field' },
      h('label', { class: 'qt-field-label' }, 'Пояснение (необязательно)'),
      explanationInput
    ),
    h('div', { class: 'qt-field' },
      h('label', { class: 'qt-field-label' }, 'Теги'),
      tagsInput
    ),
    h('hr', { class: 'divider' }),
    h('div', { class: 'qt-section-title' }, 'Правильный ответ'),
    payloadHost,
    h('div', { class: 'qt-constructor-actions' },
      h('button', {
        class: 'btn btn-lg qt-save-btn',
        type: 'button',
        onclick: async () => {
          const payload = payloadCollector
            ? payloadCollector()
            : { value: {}, valid: false, error: 'Нет данных' };
          if (!payload.valid) {
            toastError(payload.error ?? 'Заполните данные');
            return;
          }
          if (!textInput.value.trim()) {
            toastError('Введите текст вопроса');
            textInput.focus();
            return;
          }

          const btn = document.querySelector<HTMLButtonElement>('.qt-save-btn');
          if (btn) {
            btn.disabled = true;
            btn.classList.add('btn-loading');
          }

          try {
            const setting = currentSetting();
            const created = await api.post<{ question: { id: string } }>('/questions', {
              subjectId: test.subjectId,
              type: currentType,
              text: textInput.value.trim(),
              explanation: explanationInput.value.trim() || undefined,
              difficulty: parseInt(difficultyInput.value, 10) || 2,
              tags: tagsInput.value.split(',').map((s) => s.trim()).filter(Boolean),
              payload: payload.value,
            });

            const items = [
              ...test.questions.map((q, i) => ({
                questionId: q.id,
                orderIndex: i,
                pointsOverride: q.pointsOverride ?? undefined,
              })),
              {
                questionId: created.question.id,
                orderIndex: test.questions.length,
                pointsOverride: setting?.defaultPoints ?? undefined,
              },
            ];

            await api.post(`/tests/admin/${test.id}/questions`, { items });
            toastSuccess('Вопрос создан и добавлен в тест');

            textInput.value = '';
            explanationInput.value = '';
            tagsInput.value = '';

            onSuccess();
            close();
          } catch (err) {
            toastError(isApiError(err) ? err.message : 'Ошибка сохранения');
            if (btn) {
              btn.disabled = false;
              btn.classList.remove('btn-loading');
            }
          }
        },
      },
        icon('plus-circle', { size: 18 }),
        'Создать и добавить в тест'
      )
    )
  );

  mount(host, body);
  updateHint();
  renderPayload();
}

function renderPayloadFor(
  type: string,
  setting: QuestionTypeSetting | undefined,
  existing: { payload?: Record<string, unknown> } | null,
  host: HTMLElement
): () => PayloadCollector {
  const p = existing?.payload ?? {};

  switch (type) {
    case 'input_number': {
      const correct = h('input', {
        class: 'input',
        type: 'number',
        step: 'any',
        placeholder: 'Например, 42',
        value: p.correct !== undefined ? String(p.correct) : '',
      }) as HTMLInputElement;

      const tolerance = h('input', {
        class: 'input',
        type: 'number',
        step: 'any',
        placeholder: '0',
        value: p.tolerance ? String(p.tolerance) : '',
      }) as HTMLInputElement;

      mount(host,
        h('div', { class: 'qt-form-grid-2' },
          h('div', { class: 'qt-field' },
            h('label', { class: 'qt-field-label' }, 'Правильный ответ'),
            correct
          ),
          h('div', { class: 'qt-field' },
            h('label', { class: 'qt-field-label' }, 'Допуск (±)'),
            tolerance
          )
        )
      );

      return () => {
        const c = parseFloat(correct.value);
        if (isNaN(c)) return { value: {}, valid: false, error: 'Введите правильный ответ' };
        const tol = tolerance.value ? parseFloat(tolerance.value) : 0;
        return { value: { correct: c, tolerance: isNaN(tol) ? 0 : tol }, valid: true };
      };
    }

    case 'input_text':
    case 'formula': {
      const isFormula = type === 'formula';
      const correct = h('input', {
        class: 'input',
        placeholder: isFormula
          ? 'Выражение (например, 2 + 2)'
          : 'Правильный ответ. Несколько — через |',
        value: Array.isArray(p.correct)
          ? (p.correct as string[]).join(' | ')
          : ((p.correct as string) ?? ''),
      }) as HTMLInputElement;

      mount(host,
        h('div', { class: 'qt-field' },
          h('label', { class: 'qt-field-label' }, 'Правильный ответ'),
          correct,
          !isFormula
            ? h('div', { class: 'qt-field-hint' }, 'Несколько вариантов разделяйте символом |')
            : null
        )
      );

      return () => {
        const v = correct.value.trim();
        if (!v) return { value: {}, valid: false, error: 'Введите правильный ответ' };
        if (isFormula) return { value: { correct: v }, valid: true };
        return {
          value: { correct: v.split('|').map((s) => s.trim()).filter(Boolean) },
          valid: true,
        };
      };
    }

    case 'single_choice':
    case 'multi_choice': {
      const isMulti = type === 'multi_choice';
      const options = (Array.isArray(p.options) ? p.options : []) as Array<{
        id: string;
        text: string;
      }>;
      const correctIds = new Set<string>(
        isMulti
          ? (Array.isArray(p.correct) ? (p.correct as string[]) : [])
          : (p.correct ? [p.correct as string] : [])
      );

      const optsHost = h('div', { class: 'qt-options-list' });

      let localOptions: Array<{ id: string; text: string }> =
        options.length > 0
          ? options.map((o) => ({ ...o }))
          : [
              { id: 'a', text: '' },
              { id: 'b', text: '' },
            ];

      const renderOpts = (): void => {
        clear(optsHost);

        localOptions.forEach((opt, idx) => {
          const textInput = h('input', {
            class: 'input',
            placeholder: `Вариант ${idx + 1}`,
            value: opt.text,
            oninput: (e: Event) => {
              opt.text = (e.target as HTMLInputElement).value;
            },
          }) as HTMLInputElement;

          const checkInput = h('input', {
            type: isMulti ? 'checkbox' : 'radio',
            name: isMulti ? 'qt-correct-multi' : 'qt-correct-single',
            checked: correctIds.has(opt.id),
            onchange: () => {
              if (isMulti) {
                if (correctIds.has(opt.id)) correctIds.delete(opt.id);
                else correctIds.add(opt.id);
              } else {
                correctIds.clear();
                correctIds.add(opt.id);
              }
            },
          }) as HTMLInputElement;

          optsHost.appendChild(
            h('div', { class: 'qt-option-row' },
              h('label', {
                class: `check ${isMulti ? '' : 'check-radio'}`,
                style: 'flex: 0 0 auto;',
              },
                checkInput,
                h('span', { class: 'check-box' })
              ),
              h('div', { class: 'grow', style: 'min-width: 0;' }, textInput),
              h('button', {
                class: 'btn btn-ghost btn-icon btn-sm',
                type: 'button',
                disabled: localOptions.length <= 2,
                title: 'Удалить вариант',
                onclick: () => {
                  localOptions = localOptions.filter((o) => o.id !== opt.id);
                  correctIds.delete(opt.id);
                  renderOpts();
                },
              }, icon('x', { size: 16, className: 'icon icon-sm' }))
            )
          );
        });

        const max = setting?.maxOptions ?? 10;
        const canAdd = localOptions.length < max;

        optsHost.appendChild(
          h('button', {
            class: 'btn btn-secondary btn-sm qt-add-option',
            type: 'button',
            disabled: !canAdd,
            onclick: () => {
              const usedIds = new Set(localOptions.map((o) => o.id));
              let nextId = 'a';
              for (let i = 0; i < 26; i++) {
                const candidate = String.fromCharCode(97 + i);
                if (!usedIds.has(candidate)) {
                  nextId = candidate;
                  break;
                }
              }
              localOptions.push({ id: nextId, text: '' });
              renderOpts();
            },
          },
            icon('plus', { size: 14, className: 'icon icon-sm' }),
            'Добавить вариант'
          )
        );
      };

      renderOpts();

      mount(host,
        h('div', { class: 'qt-field' },
          h('label', { class: 'qt-field-label' },
            isMulti ? 'Варианты (отметьте правильные)' : 'Варианты (отметьте правильный)'
          ),
          optsHost
        )
      );

      return () => {
        const filled = localOptions.filter((o) => o.text.trim());
        const min = setting?.minOptions ?? 2;
        if (filled.length < min) {
          return { value: {}, valid: false, error: `Минимум ${min} варианта` };
        }
        if (correctIds.size === 0) {
          return { value: {}, valid: false, error: 'Отметьте правильный ответ' };
        }
        const validCorrect = [...correctIds].filter((id) =>
          filled.some((o) => o.id === id)
        );
        if (validCorrect.length === 0) {
          return {
            value: {},
            valid: false,
            error: 'Правильный ответ должен быть среди заполненных',
          };
        }
        return {
          value: {
            options: filled.map((o) => ({ id: o.id, text: o.text })),
            correct: isMulti ? validCorrect : validCorrect[0],
          },
          valid: true,
        };
      };
    }

    case 'matching': {
      const left = (Array.isArray(p.left) ? (p.left as string[]) : ['', '']).slice();
      const right = (Array.isArray(p.right) ? (p.right as string[]) : ['', '']).slice();
      const correct =
        p.correct && typeof p.correct === 'object'
          ? ({ ...(p.correct as Record<string, string>) })
          : {};

      const localLeft = [...left];
      const localRight = [...right];

      const leftHost = h('div', { class: 'qt-options-list' });
      const rightHost = h('div', { class: 'qt-options-list' });
      const correctHost = h('div', { class: 'qt-options-list' });

      const renderLeft = (): void => {
        clear(leftHost);
        localLeft.forEach((v, idx) => {
          leftHost.appendChild(
            h('div', { class: 'qt-option-row' },
              h('input', {
                class: 'input',
                value: v,
                placeholder: `Слева ${idx + 1}`,
                oninput: (e: Event) => {
                  localLeft[idx] = (e.target as HTMLInputElement).value;
                },
              }),
              h('button', {
                class: 'btn btn-ghost btn-icon btn-sm',
                type: 'button',
                disabled: localLeft.length <= 2,
                onclick: () => {
                  localLeft.splice(idx, 1);
                  renderLeft();
                  renderCorrect();
                },
              }, icon('x', { size: 16, className: 'icon icon-sm' }))
            )
          );
        });
      };

      const renderRight = (): void => {
        clear(rightHost);
        localRight.forEach((v, idx) => {
          rightHost.appendChild(
            h('div', { class: 'qt-option-row' },
              h('input', {
                class: 'input',
                value: v,
                placeholder: `Справа ${idx + 1}`,
                oninput: (e: Event) => {
                  localRight[idx] = (e.target as HTMLInputElement).value;
                },
              }),
              h('button', {
                class: 'btn btn-ghost btn-icon btn-sm',
                type: 'button',
                disabled: localRight.length <= 2,
                onclick: () => {
                  localRight.splice(idx, 1);
                  renderRight();
                  renderCorrect();
                },
              }, icon('x', { size: 16, className: 'icon icon-sm' }))
            )
          );
        });
      };

      const renderCorrect = (): void => {
        clear(correctHost);
        const filledLeft = localLeft.filter((s) => s.trim());
        const filledRight = localRight.filter((s) => s.trim());

        if (filledLeft.length === 0 || filledRight.length === 0) {
          correctHost.appendChild(
            h('div', { class: 'qt-field-hint' },
              'Заполните обе колонки, чтобы настроить соответствия.'
            )
          );
          return;
        }

        for (const l of filledLeft) {
          const select = h('select', { class: 'select' }) as HTMLSelectElement;
          select.appendChild(h('option', { value: '' }, '— выберите —'));
          for (const r of filledRight) {
            select.appendChild(h('option', {
              value: r,
              selected: correct[l] === r,
            }, r));
          }
          select.addEventListener('change', () => {
            correct[l] = select.value;
          });

          correctHost.appendChild(
            h('div', { class: 'qt-option-row' },
              h('div', { class: 'qt-pair-left' }, l),
              icon('arrow-right', { size: 16, className: 'icon icon-sm qt-pair-arrow' }),
              select
            )
          );
        }
      };

      renderLeft();
      renderRight();
      renderCorrect();

      mount(host,
        h('div', { class: 'qt-form-grid-2' },
          h('div', { class: 'qt-field' },
            h('label', { class: 'qt-field-label' }, 'Левая колонка'),
            leftHost,
            h('button', {
              class: 'btn btn-secondary btn-sm mt-2',
              type: 'button',
              disabled: localLeft.length >= (setting?.maxOptions ?? 8),
              onclick: () => {
                localLeft.push('');
                renderLeft();
                renderCorrect();
              },
            },
              icon('plus', { size: 14, className: 'icon icon-sm' }),
              'Добавить'
            )
          ),
          h('div', { class: 'qt-field' },
            h('label', { class: 'qt-field-label' }, 'Правая колонка'),
            rightHost,
            h('button', {
              class: 'btn btn-secondary btn-sm mt-2',
              type: 'button',
              disabled: localRight.length >= (setting?.maxOptions ?? 8),
              onclick: () => {
                localRight.push('');
                renderRight();
                renderCorrect();
              },
            },
              icon('plus', { size: 14, className: 'icon icon-sm' }),
              'Добавить'
            )
          )
        ),
        h('div', { class: 'qt-field mt-4' },
          h('label', { class: 'qt-field-label' }, 'Соответствия'),
          correctHost
        )
      );

      return () => {
        const filledLeft = localLeft.map((s) => s.trim()).filter(Boolean);
        const filledRight = localRight.map((s) => s.trim()).filter(Boolean);
        const min = setting?.minOptions ?? 2;
        if (filledLeft.length < min || filledRight.length < min) {
          return { value: {}, valid: false, error: `Минимум ${min} пар` };
        }
        const missing = filledLeft.filter((l) => !correct[l]);
        if (missing.length > 0) {
          return {
            value: {},
            valid: false,
            error: `Не задано соответствие: ${missing.join(', ')}`,
          };
        }
        return {
          value: {
            left: filledLeft,
            right: filledRight,
            correct: { ...correct },
          },
          valid: true,
        };
      };
    }

    case 'ordering': {
      const items = (Array.isArray(p.items) ? (p.items as string[]) : ['', '']).slice();
      const localItems = [...items];

      const itemsHost = h('div', { class: 'qt-options-list' });

      const renderItems = (): void => {
        clear(itemsHost);
        localItems.forEach((v, idx) => {
          itemsHost.appendChild(
            h('div', { class: 'qt-option-row' },
              h('div', { class: 'question-number' }, String(idx + 1)),
              h('div', { class: 'grow', style: 'min-width: 0;' },
                h('input', {
                  class: 'input',
                  value: v,
                  placeholder: `Элемент ${idx + 1}`,
                  oninput: (e: Event) => {
                    localItems[idx] = (e.target as HTMLInputElement).value;
                  },
                })
              ),
              h('button', {
                class: 'btn btn-ghost btn-icon btn-sm',
                type: 'button',
                disabled: localItems.length <= 2,
                onclick: () => {
                  localItems.splice(idx, 1);
                  renderItems();
                },
              }, icon('x', { size: 16, className: 'icon icon-sm' }))
            )
          );
        });
      };

      renderItems();

      mount(host,
        h('div', { class: 'qt-field' },
          h('label', { class: 'qt-field-label' }, 'Элементы в правильном порядке'),
          itemsHost,
          h('button', {
            class: 'btn btn-secondary btn-sm mt-2',
            type: 'button',
            disabled: localItems.length >= (setting?.maxOptions ?? 10),
            onclick: () => {
              localItems.push('');
              renderItems();
            },
          },
            icon('plus', { size: 14, className: 'icon icon-sm' }),
            'Добавить элемент'
          )
        )
      );

      return () => {
        const filled = localItems.map((s) => s.trim()).filter(Boolean);
        const min = setting?.minOptions ?? 2;
        if (filled.length < min) {
          return { value: {}, valid: false, error: `Минимум ${min} элемента` };
        }
        return {
          value: { items: filled, correct: filled.map((_, i) => i) },
          valid: true,
        };
      };
    }

    default: {
      mount(host, h('div', { class: 'alert alert-warning' }, 'Тип не поддержан'));
      return () => ({
        value: {},
        valid: false,
        error: `Неподдерживаемый тип: ${type}`,
      });
    }
  }
}

// ============================================================
// МЕТАДАННЫЕ ТЕСТА
// ============================================================

function openMetaEditModal(test: AdminTest, onSuccess: () => void): void {
  const isPublished = test.status === 'published';

  const titleInput = h('input', { class: 'input', value: test.title, disabled: isPublished }) as HTMLInputElement;
  const descInput = h('textarea', { class: 'textarea', disabled: isPublished }) as HTMLTextAreaElement;
  descInput.value = test.description ?? '';
  const timeInput = h('input', { class: 'input', type: 'number', value: String(test.timeLimitSec), disabled: isPublished }) as HTMLInputElement;
  const gradeMinInput = h('input', { class: 'input', type: 'number', value: test.gradeMin ? String(test.gradeMin) : '', disabled: isPublished }) as HTMLInputElement;
  const gradeMaxInput = h('input', { class: 'input', type: 'number', value: test.gradeMax ? String(test.gradeMax) : '', disabled: isPublished }) as HTMLInputElement;
  const pointsFixed = h('input', { class: 'input', type: 'number', value: String(test.pointsFixed), disabled: isPublished }) as HTMLInputElement;
  const pointsPerCorrect = h('input', { class: 'input', type: 'number', value: String(test.pointsPerCorrect), disabled: isPublished }) as HTMLInputElement;
  const pointsPenalty = h('input', { class: 'input', type: 'number', value: String(test.pointsPenaltyWrong), disabled: isPublished }) as HTMLInputElement;
  const shuffleQ = h('input', { type: 'checkbox', checked: test.shuffleQuestions }) as HTMLInputElement;
  const shuffleO = h('input', { type: 'checkbox', checked: test.shuffleOptions }) as HTMLInputElement;
  const allowRetake = h('input', { type: 'checkbox', checked: test.allowRetake }) as HTMLInputElement;
  const rewardOnRetake = h('input', { type: 'checkbox', checked: test.rewardOnRetake }) as HTMLInputElement;

  const body = h('div', { class: 'stack' },
    isPublished
      ? h('div', { class: 'alert alert-info' },
          icon('info', { size: 18, className: 'icon icon-sm alert-icon' }),
          'Опубликованный тест можно менять только в режиме повторного прохождения и перемешивания.'
        )
      : null,
    h('div', { class: 'field' },
      h('label', { class: 'field-label' }, 'Название'),
      titleInput
    ),
    h('div', { class: 'field' },
      h('label', { class: 'field-label' }, 'Описание'),
      descInput
    ),
    h('div', { class: 'grid grid-2 gap-3' },
      h('div', { class: 'field', style: 'margin: 0;' },
        h('label', { class: 'field-label' }, 'Время (сек)'),
        timeInput
      ),
      h('div', { class: 'field', style: 'margin: 0;' },
        h('label', { class: 'field-label' }, 'Класс от / до'),
        h('div', { class: 'row gap-2' }, gradeMinInput, gradeMaxInput)
      )
    ),
    h('div', { class: 'grid grid-3 gap-3' },
      h('div', { class: 'field', style: 'margin: 0;' },
        h('label', { class: 'field-label' }, 'Фикс. баллы'),
        pointsFixed
      ),
      h('div', { class: 'field', style: 'margin: 0;' },
        h('label', { class: 'field-label' }, 'За верный'),
        pointsPerCorrect
      ),
      h('div', { class: 'field', style: 'margin: 0;' },
        h('label', { class: 'field-label' }, 'Штраф'),
        pointsPenalty
      )
    ),
    h('div', { class: 'column-tight' },
      h('label', { class: 'check' }, shuffleQ, h('span', { class: 'check-box' }), h('span', null, 'Перемешивать вопросы')),
      h('label', { class: 'check' }, shuffleO, h('span', { class: 'check-box' }), h('span', null, 'Перемешивать варианты')),
      h('label', { class: 'check' }, allowRetake, h('span', { class: 'check-box' }), h('span', null, 'Разрешить повторное прохождение')),
      h('label', { class: 'check' }, rewardOnRetake, h('span', { class: 'check-box' }), h('span', null, 'Начислять баллы за повторное'))
    )
  );

  openModal({
    title: 'Метаданные теста',
    body,
    size: 'lg',
    actions: [
      { label: 'Отмена', variant: 'secondary' },
      {
        label: 'Сохранить',
        variant: 'primary',
        onClick: async () => {
          try {
            const payload: Record<string, unknown> = {
              shuffleQuestions: shuffleQ.checked,
              shuffleOptions: shuffleO.checked,
              allowRetake: allowRetake.checked,
              rewardOnRetake: rewardOnRetake.checked,
            };
            if (!isPublished) {
              payload.title = titleInput.value.trim();
              payload.description = descInput.value.trim() || undefined;
              payload.timeLimitSec = parseInt(timeInput.value, 10);
              payload.gradeMin = gradeMinInput.value ? parseInt(gradeMinInput.value, 10) : undefined;
              payload.gradeMax = gradeMaxInput.value ? parseInt(gradeMaxInput.value, 10) : undefined;
              payload.pointsFixed = parseInt(pointsFixed.value, 10);
              payload.pointsPerCorrect = parseInt(pointsPerCorrect.value, 10);
              payload.pointsPenaltyWrong = parseInt(pointsPenalty.value, 10);
            }
            await api.patch(`/tests/admin/${test.id}`, payload);
            toastSuccess('Сохранено');
            onSuccess();
            return true;
          } catch (err) {
            toastError(isApiError(err) ? err.message : 'Ошибка');
            return false;
          }
        },
      },
    ],
  });
}