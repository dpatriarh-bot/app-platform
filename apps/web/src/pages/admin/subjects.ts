// ============================================================
// pages/admin/subjects.ts — CRUD дисциплин с баром классов 1–11
// + расширенный выбор иконок (60+) и цветов (24) с группировкой.
// ============================================================

import { h, mount, clear } from '../../lib/dom.js';
import { icon, type IconName } from '../../lib/icons.js';
import { api, isApiError } from '../../lib/api.js';
import { router } from '../../lib/router.js';
import { adminLayout, setRoot } from '../../components/layout.js';
import { emptyState, loader } from '../../components/ui.js';
import { field, form } from '../../components/form.js';
import { openModal, confirmModal } from '../../lib/modal.js';
import { toastSuccess, toastError } from '../../lib/toast.js';

interface SubjectItem {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  grades: number[];
  gradeMin: number | null;
  gradeMax: number | null;
  orderIndex: number;
  isActive: boolean;
  testsCount: number;
  allTestsCount: number;
}

interface GradesSummaryItem {
  grade: number;
  subjectsCount: number;
}

// ============================================================
// ИКОНКИ — сгруппированы по тематике для удобства выбора
// ============================================================

interface IconGroup {
  title: string;
  icons: IconName[];
}

const ICON_GROUPS: IconGroup[] = [
  {
    title: 'Наука и математика',
    icons: [
      'hash',           // математика
      'percent',        // проценты
      'divide',         // деление
      'plus-circle',    // сложение
      'minus-circle',   // вычитание
      'trending-up',    // алгебра/анализ
      'bar-chart-2',    // статистика
      'pie-chart',      // диаграммы
      'activity',       // график функции
      'zap',            // физика / энергия
      'thermometer',    // тепло
      'wind',           // воздух/ветер
    ],
  },
  {
    title: 'Языки и литература',
    icons: [
      'book',           // литература
      'book-open',      // чтение
      'edit-2',         // письмо
      'edit-3',         // ручка
      'feather',        // перо
      'type',           // текст
      'align-left',     // текст слева
      'message-circle', // речь
      'message-square', // диалог
      'mic',            // аудирование
      'globe',          // иностранный / языки
    ],
  },
  {
    title: 'Естествознание',
    icons: [
      'sun',            // биология / природа (замена leaf)
      'droplet',        // химия / жидкость
      'cloud',          // погода
      'cloud-rain',     // осадки
      'moon',           // астрономия
      'star',           // звёзды
      'compass',        // география
      'map',            // карта
      'map-pin',        // география
      'anchor',         // море
      'triangle',       // рельеф (замена mountain)
    ],
  },
  {
    title: 'Общество и история',
    icons: [
      'clock',          // история
      'watch',          // время
      'calendar',       // даты
      'users',          // общество
      'user',           // человек
      'user-check',     // гражданин
      'flag',           // родина / ОБЗР
      'shield',         // безопасность
      'shield-off',     // безопасность
      'award',          // награды / трофей (замена trophy)
      'home',           // государство (замена landmark)
      'briefcase',      // экономика
      'sliders',        // право / весы (замена scale)
    ],
  },
  {
    title: 'Искусство и творчество',
    icons: [
      'music',          // музыка
      'headphones',     // слушание
      'image',          // ИЗО / палитра (замена palette)
      'camera',         // фотография
      'film',           // кино
      'pen-tool',       // рисование / дизайн
      'scissors',       // творчество
      'tool',           // труд / инструмент (замена wrench)
      'cpu',            // информатика
      'monitor',        // компьютер
      'smartphone',     // ИКТ
      'code',           // программирование
      'terminal',       // программирование
      'database',       // данные
      'wifi',           // сети
    ],
  },
  {
    title: 'Спорт и здоровье',
    icons: [
      'heart',          // здоровье
      'smile',          // хорошее настроение
      'target',         // цель
      'circle',         // мяч
      'play',           // физическая культура
      'play-circle',    // старт
      'zap',            // активность
      'award',          // победа
    ],
  },
  {
    title: 'Прочее и универсальные',
    icons: [
      'star',           // избранное
      'sunrise',        // начало
      'compass',        // направление
      'layers',         // структура
      'grid',           // сетка
      'box',            // объект
      'package',        // комплект
      'file-text',      // документ
      'clipboard',      // задания
      'check-circle',   // верное
      'info',           // информация
      'help-circle',    // вопрос
    ],
  },
];

// Сводим все иконки в один плоский массив (для проверки, что текущая иконка в списке)
const ALL_ICONS: IconName[] = ICON_GROUPS.flatMap((g) => g.icons);

// ============================================================
// ПАЛИТРА — 24 цвета, сгруппированы по тональности
// ============================================================

interface ColorGroup {
  title: string;
  colors: string[];
}

const COLOR_GROUPS: ColorGroup[] = [
  {
    title: 'Синие и голубые',
    colors: ['#247EE5', '#1E63C4', '#00B8D4', '#00ACC1', '#4C75A3', '#4F63D2'],
  },
  {
    title: 'Зелёные',
    colors: ['#66B132', '#34C759', '#1BB8A2', '#128A78', '#7ED957', '#0E8A3E'],
  },
  {
    title: 'Тёплые (жёлтый/оранжевый)',
    colors: ['#F7BF3F', '#E8A013', '#FF8A3D', '#D97706', '#C88500', '#FFB865'],
  },
  {
    title: 'Красные и розовые',
    colors: ['#E23B3B', '#EC6A72', '#FF5C8A', '#C2185B', '#B83F47', '#F2867D'],
  },
  {
    title: 'Фиолетовые',
    colors: ['#7C4DFF', '#5E35B1', '#9C27B0', '#B388FF', '#6A1B9A', '#8E24AA'],
  },
  {
    title: 'Нейтральные',
    colors: ['#173454', '#5E7690', '#8A9CB0', '#B8C7D6', '#7A7A7A', '#2F2F2F'],
  },
];

const ALL_COLORS: string[] = COLOR_GROUPS.flatMap((g) => g.colors);

const ALL_GRADES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

// ============================================================
// PAGE
// ============================================================

export async function renderAdminSubjects(): Promise<void> {
  const root = h('div');

  setRoot(adminLayout({
    active: 'subjects',
    title: 'Дисциплины',
    subtitle: 'Управление предметами и доступностью по классам',
    actions: [
      h('button', {
        class: 'btn',
        type: 'button',
        onclick: () => openSubjectModal(null, () => router.reload()),
      },
        icon('plus', { size: 18 }),
        'Добавить'
      ),
    ],
    content: root,
  }));

  mount(root, loader());

  try {
    const params = getQueryParams();
    const gradeFilter = params.get('grade');
    const qFilter = params.get('q') ?? '';

    const subjectsQs = new URLSearchParams();
    if (gradeFilter) subjectsQs.set('grade', gradeFilter);
    if (qFilter) subjectsQs.set('q', qFilter);

    const [subjectsRes, gradesRes] = await Promise.all([
      api.get<{ items: SubjectItem[] }>(`/subjects?${subjectsQs.toString()}`),
      api.get<{ items: GradesSummaryItem[] }>('/subjects/admin/grades-summary'),
    ]);

    const content = h('div', { class: 'stack-lg' });

    const searchInput = h('input', {
      class: 'input',
      type: 'search',
      placeholder: 'Поиск по названию дисциплины...',
      value: qFilter,
      style: 'max-width: 320px;',
      onkeydown: (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
          navigateWithFilters({ q: searchInput.value, page: 1 });
        }
      },
    }) as HTMLInputElement;

    content.appendChild(
      h('div', { class: 'row gap-3 row-wrap anim-slide-up' },
        searchInput,
        (gradeFilter || qFilter)
          ? h('button', {
              class: 'btn btn-secondary btn-sm',
              type: 'button',
              onclick: () => navigateWithFilters({ grade: '', q: '' }),
            },
              icon('x', { size: 14, className: 'icon icon-sm' }),
              'Сбросить фильтры'
            )
          : null
      )
    );

    content.appendChild(renderGradeBar(gradesRes.items, gradeFilter));

    if (subjectsRes.items.length === 0) {
      content.appendChild(
        emptyState({
          illustration: 'empty',
          title: gradeFilter
            ? `В ${gradeFilter} классе нет дисциплин`
            : 'Дисциплин пока нет',
          description: gradeFilter
            ? 'Измените фильтр или добавьте новую дисциплину в этот класс.'
            : 'Создайте первую дисциплину, чтобы можно было добавлять тесты.',
          action: h('button', {
            class: 'btn',
            type: 'button',
            onclick: () => openSubjectModal(null, () => router.reload()),
          },
            icon('plus', { size: 18 }),
            'Создать первую'
          ),
        })
      );
    } else {
      const activeGrade = gradeFilter ? Number(gradeFilter) : null;
      const grid = h('div', { class: 'grid grid-auto-280 stagger' });
      for (const s of subjectsRes.items) {
        grid.appendChild(renderCard(s, activeGrade));
      }
      content.appendChild(grid);
    }

    mount(root, content);
  } catch (err) {
    mount(root, emptyState({
      illustration: 'error',
      title: 'Не удалось загрузить дисциплины',
      description: isApiError(err) ? err.message : 'Попробуйте позже',
      action: h('button', {
        class: 'btn',
        type: 'button',
        onclick: () => router.reload(),
      }, 'Обновить'),
    }));
  }
}

// ============================================================
// БАР КЛАССОВ 1–11
// ============================================================

function renderGradeBar(
  summary: GradesSummaryItem[],
  activeFilter: string | null
): HTMLElement {
  const bar = h('div', { class: 'grade-bar anim-slide-up delay-1' });

  bar.appendChild(
    h('button', {
      class: `grade-chip ${!activeFilter ? 'is-active' : ''}`,
      type: 'button',
      onclick: () => navigateWithFilters({ grade: '' }),
    },
      h('span', { class: 'grade-chip-label' }, 'Все'),
      h('span', { class: 'grade-chip-count' }, String(
        summary.reduce((acc, it) => acc + it.subjectsCount, 0)
      ))
    )
  );

  for (const grade of ALL_GRADES) {
    const item = summary.find((s) => s.grade === grade);
    const count = item?.subjectsCount ?? 0;
    const isActive = activeFilter === String(grade);
    const isEmpty = count === 0;

    bar.appendChild(
      h('button', {
        class: `grade-chip ${isActive ? 'is-active' : ''} ${isEmpty ? 'is-empty' : ''}`,
        type: 'button',
        title: isEmpty ? `В ${grade} классе пока нет дисциплин` : `${count} дисциплин`,
        onclick: () => navigateWithFilters({ grade: String(grade) }),
      },
        h('span', { class: 'grade-chip-label' }, `${grade} класс`),
        h('span', { class: 'grade-chip-count' }, String(count))
      )
    );
  }

  return bar;
}

// ============================================================
// КАРТОЧКА ДИСЦИПЛИНЫ
// ============================================================

function renderCard(s: SubjectItem, activeGrade: number | null): HTMLElement {
  const gradesRow = h('div', { class: 'subject-grades-row' });

  for (const g of ALL_GRADES) {
    const isInSubject = s.grades.includes(g);
    const isActiveFilter = activeGrade === g;
    const classes = ['subject-grade-tag'];
    if (isActiveFilter) classes.push('is-active-filter');
    else if (isInSubject) classes.push('is-in-range');
    gradesRow.appendChild(
      h('span', { class: classes.join(' '), title: `Класс ${g}` }, String(g))
    );
  }

  return h('div', { class: 'card card-pad stagger-item' },
    h('div', { class: 'row-between' },
      h('div', {
        class: 'subject-card-icon',
        style: `background: ${s.color ?? 'var(--c-primary)'};`,
      }, icon((s.icon as IconName) ?? 'book-open', { size: 22 })),
      h('div', { class: 'row gap-1' },
        h('button', {
          class: 'btn btn-ghost btn-icon btn-sm',
          type: 'button',
          title: 'Редактировать',
          onclick: () => openSubjectModal(s, () => router.reload()),
        }, icon('edit-2', { size: 16, className: 'icon icon-sm' })),
        h('button', {
          class: 'btn btn-ghost btn-icon btn-sm',
          type: 'button',
          title: 'Удалить',
          onclick: async () => {
            const ok = await confirmModal({
              title: 'Удалить дисциплину?',
              message: `«${s.title}» будет удалена. Если в ней есть тесты — операция не пройдёт.`,
              confirmLabel: 'Удалить',
              danger: true,
            });
            if (!ok) return;
            try {
              await api.delete(`/subjects/admin/${s.id}`);
              toastSuccess('Удалено');
              router.reload();
            } catch (err) {
              toastError(isApiError(err) ? err.message : 'Не удалось удалить');
            }
          },
        }, icon('trash-2', { size: 16, className: 'icon icon-sm' }))
      )
    ),

    h('h4', { class: 'mt-4' }, s.title),
    s.description ? h('p', { class: 'text-sm text-muted mt-2' }, s.description) : null,

    h('div', { class: 'text-xs text-muted mt-4' }, 'Классы'),
    gradesRow,

    h('div', { class: 'row-between mt-5' },
      h('span', { class: 'badge badge-primary' },
        icon('file-text', { size: 12, className: 'icon icon-sm' }),
        `${s.testsCount} тестов`
      ),
      h('span', { class: `badge ${s.isActive ? 'badge-success' : ''}` },
        s.isActive ? 'Активна' : 'Скрыта'
      )
    )
  );
}

// ============================================================
// МОДАЛКА СОЗДАНИЯ/РЕДАКТИРОВАНИЯ
// ============================================================

function openSubjectModal(subject: SubjectItem | null, onSuccess: () => void): void {
  const isEdit = subject !== null;

  const slug = field({
    name: 'slug',
    label: 'Slug',
    value: subject?.slug ?? '',
    required: true,
    placeholder: 'math',
    hint: 'Только латиница, цифры и дефис',
  });

  const title = field({
    name: 'title',
    label: 'Название',
    value: subject?.title ?? '',
    required: true,
    placeholder: 'Математика',
  });

  const description = field({
    name: 'description',
    label: 'Описание',
    value: subject?.description ?? '',
    placeholder: 'Арифметика, алгебра, геометрия',
  });

  // Текущие значения — могут быть не в списке, тогда добавляем их на лету
  let selectedIcon: IconName = ((subject?.icon as IconName) ?? 'book-open');
  let selectedColor: string = subject?.color ?? '#247EE5';

  if (!ALL_ICONS.includes(selectedIcon)) {
    // Добавим во «Прочее», чтобы не потерять
    ICON_GROUPS[ICON_GROUPS.length - 1]!.icons.push(selectedIcon);
    ALL_ICONS.push(selectedIcon);
  }
  if (!ALL_COLORS.includes(selectedColor)) {
    COLOR_GROUPS[COLOR_GROUPS.length - 1]!.colors.push(selectedColor);
    ALL_COLORS.push(selectedColor);
  }

  const selectedGrades = new Set<number>(subject?.grades ?? []);

  // ---------- Иконка: сетка по группам + превью ----------
  const iconPreviewHost = h('div', { class: 'icon-picker-preview' });
  const iconGroupsHost = h('div', { class: 'icon-picker-groups' });

  const renderIconPreview = (): void => {
    clear(iconPreviewHost);
    iconPreviewHost.appendChild(
      h('div', {
        class: 'icon-picker-preview-box',
        style: `background: ${selectedColor}22; color: ${selectedColor}; border-color: ${selectedColor}55;`,
      }, icon(selectedIcon, { size: 28 }))
    );
    iconPreviewHost.appendChild(
      h('div', { class: 'icon-picker-preview-name mono text-xs' }, selectedIcon)
    );
  };

  const renderIconGroups = (): void => {
    clear(iconGroupsHost);
    for (const group of ICON_GROUPS) {
      const items = h('div', { class: 'icon-picker-grid' });
      for (const ic of group.icons) {
        items.appendChild(
          h('button', {
            class: `icon-picker-item ${selectedIcon === ic ? 'is-selected' : ''}`,
            type: 'button',
            title: ic,
            onclick: () => {
              selectedIcon = ic;
              renderIconPreview();
              renderIconGroups();
            },
          }, icon(ic, { size: 18 }))
        );
      }
      iconGroupsHost.appendChild(
        h('div', { class: 'icon-picker-group' },
          h('div', { class: 'icon-picker-group-title' }, group.title),
          items
        )
      );
    }
  };

  renderIconPreview();
  renderIconGroups();

  // ---------- Цвет: палитра по группам + превью ----------
  const colorPreviewHost = h('div', { class: 'color-picker-preview' });
  const colorGroupsHost = h('div', { class: 'color-picker-groups' });

  const renderColorPreview = (): void => {
    clear(colorPreviewHost);
    colorPreviewHost.appendChild(
      h('div', {
        class: 'color-picker-preview-box',
        style: `background: ${selectedColor};`,
      })
    );
    colorPreviewHost.appendChild(
      h('div', { class: 'color-picker-preview-name mono text-xs' }, selectedColor.toUpperCase())
    );
  };

  const renderColorGroups = (): void => {
    clear(colorGroupsHost);
    for (const group of COLOR_GROUPS) {
      const items = h('div', { class: 'color-picker-grid' });
      for (const c of group.colors) {
        items.appendChild(
          h('button', {
            class: `color-picker-item ${selectedColor.toLowerCase() === c.toLowerCase() ? 'is-selected' : ''}`,
            type: 'button',
            title: c,
            style: `background: ${c};`,
            onclick: () => {
              selectedColor = c;
              renderColorPreview();
              renderColorGroups();
              renderIconPreview();
            },
          })
        );
      }
      colorGroupsHost.appendChild(
        h('div', { class: 'color-picker-group' },
          h('div', { class: 'color-picker-group-title' }, group.title),
          items
        )
      );
    }
  };

  renderColorPreview();
  renderColorGroups();

  // ---------- Классы ----------
  const gradesPicker = h('div', { class: 'grades-picker' });

  const renderGradesPicker = (): void => {
    clear(gradesPicker);
    for (const g of ALL_GRADES) {
      const checked = selectedGrades.has(g);
      const item = h('label', {
        class: `grades-picker-item ${checked ? 'is-selected' : ''}`,
        title: `Класс ${g}`,
      },
        h('input', {
          type: 'checkbox',
          checked,
          onchange: () => {
            if (selectedGrades.has(g)) selectedGrades.delete(g);
            else selectedGrades.add(g);
            renderGradesPicker();
          },
        }),
        String(g)
      );
      gradesPicker.appendChild(item);
    }
  };

  renderGradesPicker();

  const isActive = h('input', {
    type: 'checkbox',
    checked: subject?.isActive ?? true,
  }) as HTMLInputElement;

  const f = form({
    fields: [
      title.root,
      slug.root,
      description.root,

      h('div', { class: 'field' },
        h('label', { class: 'field-label' }, 'Классы, в которых изучается'),
        gradesPicker,
        h('div', { class: 'grades-picker-hint' },
          'Пусто — без ограничений. Нажмите на класс, чтобы включить/выключить.'
        )
      ),

      h('div', { class: 'field' },
        h('label', { class: 'field-label' }, 'Иконка'),
        h('div', { class: 'icon-picker' },
          iconPreviewHost,
          iconGroupsHost
        )
      ),

      h('div', { class: 'field' },
        h('label', { class: 'field-label' }, 'Цвет'),
        h('div', { class: 'color-picker' },
          colorPreviewHost,
          colorGroupsHost
        )
      ),

      h('label', { class: 'check' },
        isActive,
        h('span', { class: 'check-box' }),
        h('span', null, 'Активна')
      ),
    ],
    submitLabel: isEdit ? 'Сохранить' : 'Создать',
    onSubmit: async () => {
      if (!title.validate() || !slug.validate()) return;

      try {
        const payload = {
          slug: slug.getValue(),
          title: title.getValue(),
          description: description.getValue(),
          icon: selectedIcon,
          color: selectedColor,
          grades: [...selectedGrades].sort((a, b) => a - b),
          isActive: isActive.checked,
        };

        if (isEdit && subject) {
          await api.patch(`/subjects/admin/${subject.id}`, payload);
          toastSuccess('Дисциплина обновлена');
        } else {
          await api.post('/subjects/admin', payload);
          toastSuccess('Дисциплина создана');
        }

        close();
        onSuccess();
      } catch (err) {
        if (isApiError(err)) {
          if (err.code === 'SLUG_TAKEN') slug.setError('Slug занят');
          f.setSubmitError(err.message);
        } else {
          f.setSubmitError('Не удалось сохранить');
        }
      }
    },
  });

  const close = openModal({
    title: isEdit ? 'Редактировать дисциплину' : 'Новая дисциплина',
    body: f.root,
    actions: [],
    size: 'lg',
  });
}

// ============================================================
// HELPERS
// ============================================================

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
  router.navigate(qs ? `/admin/subjects?${qs}` : '/admin/subjects');
}