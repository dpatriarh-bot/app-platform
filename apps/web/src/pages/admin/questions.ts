// ============================================================
// pages/admin/questions.ts — банк вопросов
// Модалка вопроса с actions (без querySelector('.modal-foot')).
// ============================================================

import { h, mount, clear } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { api, isApiError } from '../../lib/api.js';
import { router } from '../../lib/router.js';
import { adminLayout, setRoot } from '../../components/layout.js';
import { emptyState, loader, pagination } from '../../components/ui.js';
import { openModal, confirmModal } from '../../lib/modal.js';
import { toastSuccess, toastError } from '../../lib/toast.js';

type QuestionType =
  | 'input_number'
  | 'input_text'
  | 'single_choice'
  | 'multi_choice'
  | 'matching'
  | 'ordering'
  | 'formula';

interface QuestionItem {
  id: string;
  subjectId: string;
  type: QuestionType;
  text: string;
  imageUrl: string | null;
  explanation: string | null;
  payload: Record<string, unknown>;
  difficulty: number;
  tags: string[];
  isActive: boolean;
  createdAt: string;
}

interface SubjectItem {
  id: string;
  slug: string;
  title: string;
}

interface PayloadCollector {
  value: Record<string, unknown>;
  valid: boolean;
  error?: string;
}

const PAGE_SIZE = 30;

const TYPE_LABELS: Record<QuestionType, string> = {
  input_number: 'Число',
  input_text: 'Текст',
  single_choice: 'Один вариант',
  multi_choice: 'Несколько вариантов',
  matching: 'Сопоставление',
  ordering: 'Порядок',
  formula: 'Формула',
};

// ============================================================
// СПИСОК
// ============================================================

export async function renderAdminQuestions(): Promise<void> {
  const params = getQueryParams();
  const page = parseInt(params.get('page') ?? '1', 10) || 1;
  const subjectId = params.get('subjectId') ?? '';
  const type = params.get('type') ?? '';
  const q = params.get('q') ?? '';

  const root = h('div');

  setRoot(adminLayout({
    active: 'questions',
    title: 'Банк вопросов',
    actions: [
      h('button', {
        class: 'btn btn-secondary',
        type: 'button',
        onclick: () => openImportModal(() => router.reload()),
      },
        icon('upload', { size: 18 }),
        'Импорт CSV'
      ),
      h('button', {
        class: 'btn',
        type: 'button',
        onclick: () => void openQuestionModal(null, () => router.reload()),
      },
        icon('plus', { size: 18 }),
        'Создать вопрос'
      ),
    ],
    content: root,
  }));

  mount(root, loader());

  try {
    const [questionsRes, subjectsRes] = await Promise.all([
      api.get<{ items: QuestionItem[]; total: number }>(
        `/questions?${buildQuery({ page, subjectId, type, q })}`
      ),
      api.get<{ items: SubjectItem[] }>('/subjects?active=1&limit=200'),
    ]);

    const totalPages = Math.max(1, Math.ceil(questionsRes.total / PAGE_SIZE));

    const searchInput = h('input', {
      class: 'input',
      type: 'search',
      placeholder: 'Поиск по тексту...',
      value: q,
      style: 'max-width: 320px;',
      onkeydown: (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
          navigateWithFilters({ q: searchInput.value, page: 1 });
        }
      },
    }) as HTMLInputElement;

    const subjectSelect = h('select', {
      class: 'select',
      style: 'max-width: 220px;',
      onchange: () => navigateWithFilters({ subjectId: subjectSelect.value, page: 1 }),
    }) as HTMLSelectElement;
    subjectSelect.appendChild(h('option', { value: '' }, 'Все дисциплины'));
    for (const s of subjectsRes.items) {
      subjectSelect.appendChild(h('option', {
        value: s.id,
        selected: s.id === subjectId,
      }, s.title));
    }

    const typeSelect = h('select', {
      class: 'select',
      style: 'max-width: 200px;',
      onchange: () => navigateWithFilters({ type: typeSelect.value, page: 1 }),
    }) as HTMLSelectElement;
    typeSelect.appendChild(h('option', { value: '' }, 'Все типы'));
    for (const [val, label] of Object.entries(TYPE_LABELS)) {
      typeSelect.appendChild(h('option', {
        value: val,
        selected: val === type,
      }, label));
    }

    const content = h('div', { class: 'stack-lg' },
      h('div', { class: 'row gap-3 row-wrap anim-slide-up' },
        searchInput,
        subjectSelect,
        typeSelect,
        h('button', {
          class: 'btn btn-secondary btn-sm',
          type: 'button',
          onclick: () => navigateWithFilters({ q: '', subjectId: '', type: '', page: 1 }),
        }, 'Сбросить')
      ),

      h('div', { class: 'text-sm text-muted' }, `Найдено: ${questionsRes.total}`),

      questionsRes.items.length === 0
        ? emptyState({
            illustration: 'search-empty',
            title: 'Вопросов не найдено',
            description: 'Создайте вопрос или измените фильтры.',
          })
        : h('div', { class: 'stack-sm stagger' },
            ...questionsRes.items.map((item) => renderQuestionCard(item, subjectsRes.items))
          ),

      questionsRes.total > PAGE_SIZE
        ? pagination({
            page,
            totalPages,
            onChange: (p) => navigateWithFilters({ page: p }),
          })
        : null
    );

    mount(root, content);
  } catch (err) {
    mount(root, emptyState({
      illustration: 'error',
      title: 'Не удалось загрузить',
      description: isApiError(err) ? err.message : 'Попробуйте позже',
    }));
  }
}

function renderQuestionCard(q: QuestionItem, subjects: SubjectItem[]): HTMLElement {
  const subject = subjects.find((s) => s.id === q.subjectId);

  return h('div', { class: 'card card-pad stagger-item' },
    h('div', { class: 'row-between row-wrap gap-3', style: 'align-items: flex-start;' },
      h('div', { class: 'grow', style: 'min-width: 0;' },
        h('div', { class: 'row gap-2 row-wrap mb-2' },
          h('span', { class: 'badge badge-primary' }, TYPE_LABELS[q.type]),
          subject ? h('span', { class: 'badge' }, subject.title) : null,
          ...q.tags.map((t) => h('span', { class: 'badge' }, t))
        ),
        h('div', { class: 'fw-600', style: 'line-height: 1.45;' }, q.text),
        h('div', { class: 'text-xs text-dim mt-2' },
          `Сложность: ${q.difficulty}/5`,
          q.explanation ? ' · Есть пояснение' : ''
        )
      ),
      h('div', { class: 'row gap-1' },
        h('button', {
          class: 'btn btn-ghost btn-icon btn-sm',
          type: 'button',
          onclick: () => void openQuestionModal(q.id, () => router.reload()),
          title: 'Редактировать',
        }, icon('edit-2', { size: 16, className: 'icon icon-sm' })),
        h('button', {
          class: 'btn btn-ghost btn-icon btn-sm',
          type: 'button',
          onclick: async () => {
            const ok = await confirmModal({
              title: 'Удалить вопрос?',
              message: 'Если он используется в тестах — удаление не пройдёт.',
              confirmLabel: 'Удалить',
              danger: true,
            });
            if (!ok) return;
            try {
              await api.delete(`/questions/${q.id}`);
              toastSuccess('Удалено');
              router.reload();
            } catch (err) {
              toastError(isApiError(err) ? err.message : 'Ошибка');
            }
          },
          title: 'Удалить',
        }, icon('trash-2', { size: 16, className: 'icon icon-sm' }))
      )
    )
  );
}

// ============================================================
// QUESTION MODAL
// ============================================================

export async function openQuestionModal(
  questionId: string | null,
  onSuccess: () => void
): Promise<void> {
  const isEdit = questionId !== null;

  const content = h('div', { class: 'stack' }, loader());

  let saveHandler: (() => Promise<boolean>) | null = null;

  const close = openModal({
    title: isEdit ? 'Редактировать вопрос' : 'Новый вопрос',
    body: content,
    size: 'lg',
    actions: [
      { label: 'Отмена', variant: 'secondary', onClick: () => true },
      {
        label: isEdit ? 'Сохранить' : 'Создать',
        variant: 'primary',
        closeOnClick: false,
        onClick: async () => {
          if (!saveHandler) {
            toastError('Форма ещё не готова');
            return false;
          }
          const ok = await saveHandler();
          if (ok) close();
          return false;
        },
      },
    ],
  });

  try {
    const subjectsRes = await api.get<{ items: SubjectItem[] }>('/subjects?active=1&limit=200');
    const subjects = subjectsRes.items;

    let existing: QuestionItem | null = null;
    if (isEdit && questionId) {
      const detail = await api.get<{ question: QuestionItem }>(`/questions/${questionId}`);
      existing = detail.question;
    }

    const subjectSelect = h('select', { class: 'select' }) as HTMLSelectElement;
    for (const s of subjects) {
      subjectSelect.appendChild(h('option', {
        value: s.id,
        selected: s.id === existing?.subjectId,
      }, s.title));
    }

    const typeSelect = h('select', { class: 'select' }) as HTMLSelectElement;
    for (const [val, label] of Object.entries(TYPE_LABELS)) {
      typeSelect.appendChild(h('option', {
        value: val,
        selected: val === (existing?.type ?? 'input_number'),
      }, label));
    }

    const textInput = h('textarea', {
      class: 'textarea',
      placeholder: 'Текст вопроса',
    }) as HTMLTextAreaElement;
    textInput.value = existing?.text ?? '';

    const explanationInput = h('textarea', {
      class: 'textarea',
      placeholder: 'Пояснение к ответу',
    }) as HTMLTextAreaElement;
    explanationInput.value = existing?.explanation ?? '';

    const difficultyInput = h('input', {
      class: 'input',
      type: 'number',
      min: '1',
      max: '5',
      value: String(existing?.difficulty ?? 2),
    }) as HTMLInputElement;

    const tagsInput = h('input', {
      class: 'input',
      placeholder: 'через запятую',
      value: (existing?.tags ?? []).join(', '),
    }) as HTMLInputElement;

    const payloadHost = h('div');
    let payloadCollector: (() => PayloadCollector) | null = null;

    const renderPayload = (): void => {
      clear(payloadHost);
      const type = typeSelect.value as QuestionType;
      payloadCollector = renderPayloadFor(type, existing, payloadHost);
    };

    typeSelect.addEventListener('change', renderPayload);

    clear(content);
    content.appendChild(
      h('div', { class: 'stack' },
        h('div', { class: 'grid grid-2 gap-3' },
          h('div', { class: 'field', style: 'margin: 0;' },
            h('label', { class: 'field-label' }, 'Дисциплина ', h('span', { class: 'req' }, '*')),
            subjectSelect
          ),
          h('div', { class: 'field', style: 'margin: 0;' },
            h('label', { class: 'field-label' }, 'Тип вопроса'),
            typeSelect
          )
        ),
        h('div', { class: 'field' },
          h('label', { class: 'field-label' }, 'Текст вопроса ', h('span', { class: 'req' }, '*')),
          textInput
        ),
        h('div', { class: 'field' },
          h('label', { class: 'field-label' }, 'Пояснение'),
          explanationInput
        ),
        h('div', { class: 'grid grid-2 gap-3' },
          h('div', { class: 'field', style: 'margin: 0;' },
            h('label', { class: 'field-label' }, 'Сложность (1-5)'),
            difficultyInput
          ),
          h('div', { class: 'field', style: 'margin: 0;' },
            h('label', { class: 'field-label' }, 'Теги'),
            tagsInput
          )
        ),
        h('hr', { class: 'divider' }),
        payloadHost
      )
    );

    renderPayload();

    saveHandler = async (): Promise<boolean> => {
      const collected = payloadCollector
        ? payloadCollector()
        : { value: {}, valid: false, error: 'Сборщик не готов' };

      if (!collected.valid) {
        toastError(collected.error ?? 'Заполните данные');
        return false;
      }
      if (!textInput.value.trim()) {
        toastError('Введите текст вопроса');
        textInput.focus();
        return false;
      }

      try {
        const basePayload = {
          subjectId: subjectSelect.value,
          type: typeSelect.value as QuestionType,
          text: textInput.value.trim(),
          explanation: explanationInput.value.trim() || undefined,
          difficulty: parseInt(difficultyInput.value, 10) || 2,
          tags: tagsInput.value.split(',').map((s) => s.trim()).filter(Boolean),
          payload: collected.value,
        };

        if (isEdit && questionId) {
          await api.patch(`/questions/${questionId}`, basePayload);
          toastSuccess('Вопрос обновлён');
        } else {
          await api.post('/questions', basePayload);
          toastSuccess('Вопрос создан');
        }
        onSuccess();
        return true;
      } catch (err) {
        toastError(isApiError(err) ? err.message : 'Ошибка сохранения');
        return false;
      }
    };
  } catch (err) {
    clear(content);
    content.appendChild(
      h('div', { class: 'alert alert-danger' },
        isApiError(err) ? err.message : 'Не удалось открыть вопрос'
      )
    );
  }
}

// ============================================================
// RENDER PAYLOAD — по типу вопроса
// ============================================================

function renderPayloadFor(
  type: QuestionType,
  existing: QuestionItem | null,
  host: HTMLElement
): () => PayloadCollector {
  const p = existing?.payload ?? {};

  switch (type) {
    case 'input_number': {
      const correct = h('input', {
        class: 'input',
        type: 'number',
        placeholder: 'Правильный ответ',
        value: p.correct !== undefined ? String(p.correct) : '',
      }) as HTMLInputElement;

      const tolerance = h('input', {
        class: 'input',
        type: 'number',
        placeholder: '0',
        value: p.tolerance ? String(p.tolerance) : '',
      }) as HTMLInputElement;

      mount(host,
        h('div', { class: 'grid grid-2 gap-3' },
          h('div', { class: 'field', style: 'margin: 0;' },
            h('label', { class: 'field-label' }, 'Правильный ответ'),
            correct
          ),
          h('div', { class: 'field', style: 'margin: 0;' },
            h('label', { class: 'field-label' }, 'Допуск (±)'),
            tolerance
          )
        )
      );

      return () => {
        const c = parseFloat(correct.value);
        if (isNaN(c)) return { value: {}, valid: false, error: 'Введите правильный ответ' };
        return {
          value: {
            correct: c,
            tolerance: tolerance.value ? parseFloat(tolerance.value) : 0,
          },
          valid: true,
        };
      };
    }

    case 'input_text':
    case 'formula': {
      const correct = h('input', {
        class: 'input',
        placeholder: type === 'formula' ? 'Выражение (например, 2+2)' : 'Правильный ответ',
        value: Array.isArray(p.correct)
          ? (p.correct as string[]).join(' | ')
          : ((p.correct as string) ?? ''),
      }) as HTMLInputElement;

      mount(host,
        h('div', { class: 'field' },
          h('label', { class: 'field-label' },
            'Правильный ответ',
            type === 'input_text'
              ? h('span', { class: 'field-hint' }, ' Несколько вариантов — через |')
              : null
          ),
          correct
        )
      );

      return () => {
        const v = correct.value.trim();
        if (!v) return { value: {}, valid: false, error: 'Введите правильный ответ' };
        if (type === 'formula') return { value: { correct: v }, valid: true };
        return {
          value: {
            correct: v.split('|').map((s) => s.trim()).filter(Boolean),
          },
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

      const optsHost = h('div', { class: 'stack-sm' });

      const localOptions: Array<{ id: string; text: string }> =
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
            name: isMulti ? 'correct-multi' : 'correct-single',
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
            h('div', { class: 'row gap-2', style: 'flex-wrap: nowrap;' },
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
                onclick: () => {
                  const i = localOptions.indexOf(opt);
                  if (i >= 0) localOptions.splice(i, 1);
                  correctIds.delete(opt.id);
                  renderOpts();
                },
              }, icon('x', { size: 16, className: 'icon icon-sm' }))
            )
          );
        });

        optsHost.appendChild(
          h('button', {
            class: 'btn btn-secondary btn-sm',
            type: 'button',
            disabled: localOptions.length >= 10,
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
        h('div', { class: 'field' },
          h('label', { class: 'field-label' }, 'Варианты ответа'),
          optsHost
        )
      );

      return () => {
        const filled = localOptions.filter((o) => o.text.trim());
        if (filled.length < 2) {
          return { value: {}, valid: false, error: 'Минимум 2 варианта' };
        }
        if (correctIds.size === 0) {
          return { value: {}, valid: false, error: 'Отметьте правильный вариант' };
        }
        const validCorrect = [...correctIds].filter((id) =>
          filled.some((o) => o.id === id)
        );
        if (validCorrect.length === 0) {
          return {
            value: {},
            valid: false,
            error: 'Правильный ответ должен быть среди заполненных вариантов',
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
      const left = (Array.isArray(p.left) ? (p.left as string[]) : ['']).slice();
      const right = (Array.isArray(p.right) ? (p.right as string[]) : ['']).slice();
      const correct: Record<string, string> =
        p.correct && typeof p.correct === 'object'
          ? ({ ...(p.correct as Record<string, string>) })
          : {};

      const localLeft = [...left];
      const localRight = [...right];

      const leftHost = h('div', { class: 'stack-sm' });
      const rightHost = h('div', { class: 'stack-sm' });
      const correctHost = h('div', { class: 'stack-sm' });

      const renderLeft = (): void => {
        clear(leftHost);
        localLeft.forEach((v, idx) => {
          leftHost.appendChild(
            h('input', {
              class: 'input',
              value: v,
              placeholder: `Слева ${idx + 1}`,
              oninput: (e: Event) => {
                localLeft[idx] = (e.target as HTMLInputElement).value;
              },
            })
          );
        });
      };

      const renderRight = (): void => {
        clear(rightHost);
        localRight.forEach((v, idx) => {
          rightHost.appendChild(
            h('input', {
              class: 'input',
              value: v,
              placeholder: `Справа ${idx + 1}`,
              oninput: (e: Event) => {
                localRight[idx] = (e.target as HTMLInputElement).value;
              },
            })
          );
        });
      };

      const renderCorrect = (): void => {
        clear(correctHost);
        localLeft.forEach((l) => {
          if (!l) return;
          const select = h('select', { class: 'select', style: 'max-width: 200px;' }) as HTMLSelectElement;
          select.appendChild(h('option', { value: '' }, '— выберите —'));
          for (const r of localRight) {
            if (!r) continue;
            select.appendChild(h('option', {
              value: r,
              selected: correct[l] === r,
            }, r));
          }
          select.addEventListener('change', () => {
            correct[l] = select.value;
          });

          correctHost.appendChild(
            h('div', { class: 'row gap-3 row-wrap' },
              h('div', { class: 'grow fw-600 text-sm', style: 'min-width: 0;' }, l),
              select
            )
          );
        });

        if (correctHost.childElementCount === 0) {
          correctHost.appendChild(
            h('div', { class: 'text-xs text-dim' },
              'Заполните левую и правую колонки, затем настройте соответствия.'
            )
          );
        }
      };

      renderLeft();
      renderRight();
      renderCorrect();

      mount(host,
        h('div', { class: 'stack' },
          h('div', { class: 'grid grid-2 gap-3' },
            h('div', { class: 'field', style: 'margin: 0;' },
              h('label', { class: 'field-label' }, 'Левая колонка'),
              leftHost,
              h('button', {
                class: 'btn btn-secondary btn-sm mt-2',
                type: 'button',
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
            h('div', { class: 'field', style: 'margin: 0;' },
              h('label', { class: 'field-label' }, 'Правая колонка'),
              rightHost,
              h('button', {
                class: 'btn btn-secondary btn-sm mt-2',
                type: 'button',
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
          h('div', { class: 'field' },
            h('label', { class: 'field-label' }, 'Соответствия'),
            correctHost,
            h('button', {
              class: 'btn btn-secondary btn-sm mt-2',
              type: 'button',
              onclick: () => renderCorrect(),
            },
              icon('refresh-cw', { size: 14, className: 'icon icon-sm' }),
              'Обновить соответствия'
            )
          )
        )
      );

      return () => {
        const filledLeft = localLeft.map((s) => s.trim()).filter(Boolean);
        const filledRight = localRight.map((s) => s.trim()).filter(Boolean);
        if (filledLeft.length < 2 || filledRight.length < 2) {
          return { value: {}, valid: false, error: 'Минимум 2 пары' };
        }
        const missing = filledLeft.filter((l) => !correct[l]);
        if (missing.length > 0) {
          return {
            value: {},
            valid: false,
            error: `Не задано соответствие для: ${missing.join(', ')}`,
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

      const itemsHost = h('div', { class: 'stack-sm' });

      const renderItems = (): void => {
        clear(itemsHost);
        localItems.forEach((v, idx) => {
          itemsHost.appendChild(
            h('div', { class: 'row gap-2', style: 'flex-wrap: nowrap;' },
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
        h('div', { class: 'field' },
          h('label', { class: 'field-label' }, 'Элементы в правильном порядке'),
          itemsHost,
          h('button', {
            class: 'btn btn-secondary btn-sm mt-2',
            type: 'button',
            disabled: localItems.length >= 10,
            onclick: () => {
              localItems.push('');
              renderItems();
            },
          },
            icon('plus', { size: 14, className: 'icon icon-sm' }),
            'Добавить'
          )
        )
      );

      return () => {
        const filled = localItems.map((s) => s.trim()).filter(Boolean);
        if (filled.length < 2) {
          return { value: {}, valid: false, error: 'Минимум 2 элемента' };
        }
        return {
          value: {
            items: filled,
            correct: filled.map((_, i) => i),
          },
          valid: true,
        };
      };
    }

    default: {
      mount(host, h('div', { class: 'alert alert-warning' }, 'Тип не поддержан'));
      return () => ({
        value: {},
        valid: false,
        error: `Неподдерживаемый тип: ${type as string}`,
      });
    }
  }
}

// ============================================================
// IMPORT CSV
// ============================================================

function openImportModal(onSuccess: () => void): void {
  const subjectSelect = h('select', { class: 'select' }) as HTMLSelectElement;
  const fileInput = h('input', { class: 'input', type: 'file', accept: '.csv,text/csv' }) as HTMLInputElement;
  const dryRunInput = h('input', { type: 'checkbox' }) as HTMLInputElement;

  const resultHost = h('div');

  void (async () => {
    try {
      const s = await api.get<{ items: SubjectItem[] }>('/subjects?active=1&limit=200');
      for (const sub of s.items) {
        subjectSelect.appendChild(h('option', { value: sub.id }, sub.title));
      }
    } catch {
      // ignore
    }
  })();

  const body = h('div', { class: 'stack' },
    h('div', { class: 'field' },
      h('label', { class: 'field-label' }, 'Дисциплина ', h('span', { class: 'req' }, '*')),
      subjectSelect
    ),
    h('div', { class: 'field' },
      h('label', { class: 'field-label' }, 'CSV-файл'),
      fileInput,
      h('div', { class: 'field-hint' },
        'Колонки: type, text, payload, explanation, difficulty, tags. payload — JSON.'
      )
    ),
    h('label', { class: 'check' },
      dryRunInput,
      h('span', { class: 'check-box' }),
      h('span', null, 'Только проверка (dry run)')
    ),
    resultHost
  );

  openModal({
    title: 'Импорт вопросов',
    body,
    size: 'lg',
    actions: [
      { label: 'Закрыть', variant: 'secondary' },
      {
        label: 'Импортировать',
        variant: 'primary',
        closeOnClick: false,
        onClick: async () => {
          if (!subjectSelect.value || !fileInput.files?.[0]) {
            toastError('Выберите дисциплину и файл');
            return false;
          }

          const file = fileInput.files[0];
          const text = await file.text();

          try {
            const res = await api.post<{
              total: number;
              created: number;
              errors: Array<{ row: number; message: string }>;
              dryRun: boolean;
            }>('/tests/admin/import', {
              format: 'csv',
              subjectId: subjectSelect.value,
              data: text,
              dryRun: dryRunInput.checked,
            });

            const nodes: HTMLElement[] = [];

            nodes.push(
              h('div', {
                class: `alert ${res.errors.length > 0 ? 'alert-warning' : 'alert-success'} mt-3`,
              },
                icon(res.errors.length > 0 ? 'alert-triangle' : 'check-circle', {
                  size: 18,
                  className: 'icon icon-sm alert-icon',
                }),
                h('div', null,
                  h('div', { class: 'alert-title' },
                    res.dryRun ? 'Проверка завершена' : 'Импорт завершён'
                  ),
                  `Всего: ${res.total}, создано: ${res.created}, ошибок: ${res.errors.length}`
                )
              )
            );

            if (res.errors.length > 0) {
              nodes.push(
                h('div', {
                  class: 'stack-sm mt-3',
                  style: 'max-height: 200px; overflow-y: auto;',
                },
                  ...res.errors.slice(0, 20).map((e) =>
                    h('div', { class: 'text-xs text-muted' },
                      `Строка ${e.row}: ${e.message}`
                    )
                  )
                )
              );
            }

            mount(resultHost, ...nodes);

            if (!res.dryRun && res.created > 0) {
              toastSuccess(`Импортировано ${res.created} вопросов`);
              setTimeout(() => { onSuccess(); }, 1500);
            }
          } catch (err) {
            toastError(isApiError(err) ? err.message : 'Не удалось импортировать');
          }
          return false;
        },
      },
    ],
  });
}

// ============================================================
// HELPERS
// ============================================================

function buildQuery(params: {
  page: number;
  subjectId: string;
  type: string;
  q: string;
}): string {
  const qs = new URLSearchParams();
  qs.set('limit', String(PAGE_SIZE));
  qs.set('offset', String((params.page - 1) * PAGE_SIZE));
  if (params.subjectId) qs.set('subjectId', params.subjectId);
  if (params.type) qs.set('type', params.type);
  if (params.q) qs.set('q', params.q);
  return qs.toString();
}

function getQueryParams(): URLSearchParams {
  const hash = window.location.hash;
  const qIdx = hash.indexOf('?');
  if (qIdx === -1) return new URLSearchParams();
  return new URLSearchParams(hash.slice(qIdx + 1));
}

function navigateWithFilters(patch: Record<string, string | number>): void {
  const current = getQueryParams();
  const next = new URLSearchParams(current);
  for (const [k, v] of Object.entries(patch)) {
    if (v === '' || v === undefined || v === null) next.delete(k);
    else next.set(k, String(v));
  }
  const qs = next.toString();
  router.navigate(qs ? `/admin/questions?${qs}` : '/admin/questions');
}