// ============================================================
// pages/admin/tests.ts — список тестов с фильтрами
// Защита от двойного создания теста в модалке.
// ============================================================

import { h, mount } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { api, isApiError } from '../../lib/api.js';
import { router } from '../../lib/router.js';
import { adminLayout, setRoot } from '../../components/layout.js';
import { emptyState, loader, pagination, statusBadge } from '../../components/ui.js';
import { openModal } from '../../lib/modal.js';
import { toastSuccess, toastError } from '../../lib/toast.js';
import { formatDateShort, formatDuration } from '../../lib/format.js';

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
  pointsFixed: number;
  pointsPerCorrect: number;
  questionsCount: number;
  publishedAt: string | null;
  updatedAt: string;
}

interface SubjectItem {
  id: string;
  slug: string;
  title: string;
}

const PAGE_SIZE = 30;

export async function renderAdminTests(): Promise<void> {
  const params = getQueryParams();
  const page = parseInt(params.get('page') ?? '1', 10) || 1;
  const subjectId = params.get('subjectId') ?? '';
  const status = params.get('status') ?? '';
  const q = params.get('q') ?? '';

  const root = h('div');

  setRoot(adminLayout({
    active: 'tests',
    title: 'Тесты',
    actions: [
      h('button', {
        class: 'btn',
        type: 'button',
        onclick: () => openCreateTestModal(() => router.reload()),
      },
        icon('plus', { size: 18 }),
        'Новый тест'
      ),
    ],
    content: root,
  }));

  mount(root, loader());

  try {
    const [testsRes, subjectsRes] = await Promise.all([
      api.get<{ items: AdminTest[]; total: number }>(
        `/tests?${buildTestsQuery({ page, subjectId, status, q })}`
      ),
      api.get<{ items: SubjectItem[] }>('/subjects?active=1&limit=200'),
    ]);

    const totalPages = Math.max(1, Math.ceil(testsRes.total / PAGE_SIZE));

    const searchInput = h('input', {
      class: 'input',
      type: 'search',
      placeholder: 'Поиск по названию...',
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

    const statusSelect = h('select', {
      class: 'select',
      style: 'max-width: 180px;',
      onchange: () => navigateWithFilters({ status: statusSelect.value, page: 1 }),
    }) as HTMLSelectElement;
    for (const s of [
      { value: '', label: 'Все статусы' },
      { value: 'draft', label: 'Черновики' },
      { value: 'review', label: 'На проверке' },
      { value: 'published', label: 'Опубликованные' },
      { value: 'archived', label: 'Архив' },
    ]) {
      statusSelect.appendChild(h('option', {
        value: s.value,
        selected: s.value === status,
      }, s.label));
    }

    const content = h('div', { class: 'stack-lg' },
      h('div', { class: 'row gap-3 row-wrap anim-slide-up' },
        searchInput,
        subjectSelect,
        statusSelect,
        h('button', {
          class: 'btn btn-secondary btn-sm',
          type: 'button',
          onclick: () => navigateWithFilters({ q: '', subjectId: '', status: '', page: 1 }),
        }, 'Сбросить')
      ),
      h('div', { class: 'text-sm text-muted' }, `Найдено: ${testsRes.total}`),

      testsRes.items.length === 0
        ? emptyState({
            illustration: 'search-empty',
            title: 'Тесты не найдены',
            description: 'Измените фильтры или создайте новый тест.',
          })
        : h('div', { class: 'card anim-slide-up delay-1' },
            h('div', { class: 'table-wrap', style: 'border: 0; border-radius: var(--r-lg);' },
              h('table', { class: 'table' },
                h('thead', null,
                  h('tr', null,
                    h('th', null, 'Название'),
                    h('th', null, 'Статус'),
                    h('th', null, 'Вопросов'),
                    h('th', null, 'Время'),
                    h('th', null, 'Баллы'),
                    h('th', null, 'Класс'),
                    h('th', null, 'Обновлён'),
                    h('th', null, '')
                  )
                ),
                h('tbody', null,
                  ...testsRes.items.map((t) => renderRow(t, subjectsRes.items))
                )
              )
            )
          ),

      testsRes.total > PAGE_SIZE
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

function renderRow(t: AdminTest, subjects: SubjectItem[]): HTMLElement {
  const subject = subjects.find((s) => s.id === t.subjectId);

  const pointsLabel = `+${t.pointsFixed} · +${t.pointsPerCorrect}/верн.`;
  const gradeLabel = t.gradeMin && t.gradeMax ? `${t.gradeMin}–${t.gradeMax}` : '—';

  return h('tr', null,
    h('td', { 'data-label-role': 'title' },
      h('div', { style: 'min-width: 0;' },
        h('div', { class: 'fw-600' }, t.title),
        subject ? h('div', { class: 'text-xs text-muted mt-1' }, subject.title) : null
      )
    ),
    h('td', { 'data-label': 'Статус' }, statusBadge(t.status)),
    h('td', { 'data-label': 'Вопросов' }, String(t.questionsCount)),
    h('td', { 'data-label': 'Время', class: 'text-sm' }, formatDuration(t.timeLimitSec)),
    h('td', { 'data-label': 'Баллы', class: 'text-sm' }, pointsLabel),
    h('td', { 'data-label': 'Класс', class: 'text-sm' }, gradeLabel),
    h('td', { 'data-label': 'Обновлён', class: 'text-sm text-muted nowrap' }, formatDateShort(t.updatedAt)),
    h('td', { 'data-label-role': 'actions' },
      h('a', {
        class: 'btn btn-ghost btn-sm',
        href: `#/admin/tests/${t.id}`,
      }, 'Открыть')
    )
  );
}

function buildTestsQuery(params: {
  page: number;
  subjectId: string;
  status: string;
  q: string;
}): string {
  const qs = new URLSearchParams();
  qs.set('limit', String(PAGE_SIZE));
  qs.set('offset', String((params.page - 1) * PAGE_SIZE));
  if (params.subjectId) qs.set('subjectId', params.subjectId);
  if (params.status) qs.set('status', params.status);
  if (params.q) qs.set('q', params.q);
  return qs.toString();
}

function openCreateTestModal(onSuccess: () => void): void {
  const subjectSelect = h('select', { class: 'select' }) as HTMLSelectElement;
  const titleInput = h('input', { class: 'input', placeholder: 'Название теста' }) as HTMLInputElement;
  const descInput = h('textarea', { class: 'textarea', placeholder: 'Описание' }) as HTMLTextAreaElement;
  const timeInput = h('input', { class: 'input', type: 'number', value: '600', min: '30', max: '7200' }) as HTMLInputElement;
  const gradeMinInput = h('input', { class: 'input', type: 'number', min: '1', max: '11', placeholder: 'от' }) as HTMLInputElement;
  const gradeMaxInput = h('input', { class: 'input', type: 'number', min: '1', max: '11', placeholder: 'до' }) as HTMLInputElement;
  const pointsFixed = h('input', { class: 'input', type: 'number', value: '10', min: '0' }) as HTMLInputElement;
  const pointsPerCorrect = h('input', { class: 'input', type: 'number', value: '2', min: '0' }) as HTMLInputElement;
  const pointsPenalty = h('input', { class: 'input', type: 'number', value: '0', min: '0' }) as HTMLInputElement;

  let submitting = false;

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
      h('label', { class: 'field-label' }, 'Название ', h('span', { class: 'req' }, '*')),
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
    )
  );

  openModal({
    title: 'Новый тест',
    body,
    size: 'lg',
    actions: [
      { label: 'Отмена', variant: 'secondary' },
      {
        label: 'Создать',
        variant: 'primary',
        closeOnClick: false,
        onClick: async () => {
          if (submitting) return false;

          if (!titleInput.value.trim() || !subjectSelect.value) {
            toastError('Заполните обязательные поля');
            return false;
          }

          submitting = true;
          try {
            const created = await api.post<{ test: { id: string } }>('/tests/admin', {
              subjectId: subjectSelect.value,
              title: titleInput.value.trim(),
              description: descInput.value.trim() || undefined,
              timeLimitSec: parseInt(timeInput.value, 10) || 600,
              gradeMin: gradeMinInput.value ? parseInt(gradeMinInput.value, 10) : undefined,
              gradeMax: gradeMaxInput.value ? parseInt(gradeMaxInput.value, 10) : undefined,
              pointsFixed: parseInt(pointsFixed.value, 10) || 10,
              pointsPerCorrect: parseInt(pointsPerCorrect.value, 10) || 2,
              pointsPenaltyWrong: parseInt(pointsPenalty.value, 10) || 0,
            });
            toastSuccess('Тест создан');
            router.navigate(`/admin/tests/${created.test.id}`);
            onSuccess();
            return true;
          } catch (err) {
            toastError(isApiError(err) ? err.message : 'Ошибка');
            submitting = false;
            return false;
          }
        },
      },
    ],
  });
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
  router.navigate(qs ? `/admin/tests?${qs}` : '/admin/tests');
}