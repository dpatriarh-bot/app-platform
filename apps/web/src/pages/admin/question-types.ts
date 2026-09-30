// ============================================================
// pages/admin/question-types.ts — справочник типов вопросов
// Список 7 типов + тумблеры + настройки + порядок.
// ============================================================

import { h, mount, clear } from '../../lib/dom.js';
import { icon, type IconName } from '../../lib/icons.js';
import { api, isApiError } from '../../lib/api.js';
import { router } from '../../lib/router.js';
import { adminLayout, setRoot } from '../../components/layout.js';
import { emptyState, loader } from '../../components/ui.js';
import { openModal } from '../../lib/modal.js';
import { toastSuccess, toastError } from '../../lib/toast.js';

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
  createdAt: string;
  updatedAt: string;
}

const ROLE_LABELS: Record<string, string> = {
  manager: 'Менеджер',
  curator: 'Куратор',
  admin: 'Администратор',
  superadmin: 'Супер-админ',
};

export async function renderAdminQuestionTypes(): Promise<void> {
  const root = h('div');

  setRoot(adminLayout({
    active: 'question-types',
    title: 'Типы вопросов',
    subtitle: 'Справочник конструктора тестов',
    content: root,
  }));

  mount(root, loader());

  try {
    const res = await api.get<{ items: QuestionTypeSetting[] }>('/questions/type-settings');

    if (res.items.length === 0) {
      mount(root, emptyState({
        illustration: 'empty',
        title: 'Справочник пуст',
        description: 'Запустите seed для наполнения справочника типов.',
      }));
      return;
    }

    const cards = h('div', { class: 'qt-grid stagger' });
    for (const s of res.items) {
      cards.appendChild(renderTypeCard(s, () => router.reload()));
    }

    mount(root,
      h('div', { class: 'stack-lg anim-slide-up' },
        h('div', { class: 'alert alert-info' },
          icon('info', { size: 18, className: 'icon icon-sm alert-icon' }),
          h('div', null,
            h('div', { class: 'alert-title' }, 'Как это работает'),
            'Тумблер «Включён» — тип появляется в конструкторе тестов. ' +
            'Настройки баллов, диапазона вариантов и ролей применяются по умолчанию ' +
            'и могут быть переопределены для конкретного теста.'
          )
        ),
        cards
      )
    );
  } catch (err) {
    mount(root, emptyState({
      illustration: 'error',
      title: 'Не удалось загрузить справочник',
      description: isApiError(err) ? err.message : 'Попробуйте позже',
      action: h('button', {
        class: 'btn',
        type: 'button',
        onclick: () => router.reload(),
      }, 'Обновить'),
    }));
  }
}

function renderTypeCard(
  setting: QuestionTypeSetting,
  onUpdate: () => void
): HTMLElement {
  const toggleInput = h('input', {
    type: 'checkbox',
    checked: setting.isEnabled,
  }) as HTMLInputElement;

  const onToggle = async (): Promise<void> => {
    try {
      await api.patch(`/questions/type-settings/${setting.type}`, {
        isEnabled: toggleInput.checked,
      });
      toastSuccess(toggleInput.checked ? 'Тип включён' : 'Тип выключен');
      onUpdate();
    } catch (err) {
      toastError(isApiError(err) ? err.message : 'Не удалось сохранить');
      toggleInput.checked = setting.isEnabled;
    }
  };

  toggleInput.addEventListener('change', () => void onToggle());

  const iconName = (setting.icon ?? 'help-circle') as IconName;

  return h('div', { class: `qt-card stagger-item ${setting.isEnabled ? '' : 'is-disabled'}` },
    h('div', { class: 'qt-card-head' },
      h('div', { class: 'qt-card-icon' }, icon(iconName, { size: 22 })),
      h('div', { class: 'qt-card-title-block' },
        h('div', { class: 'qt-card-title' }, setting.title),
        h('div', { class: 'qt-card-code' }, setting.type)
      ),
      h('label', { class: 'switch qt-card-switch', title: setting.isEnabled ? 'Выключить' : 'Включить' },
        toggleInput,
        h('span', { class: 'switch-track' })
      )
    ),

    setting.description
      ? h('div', { class: 'qt-card-description' }, setting.description)
      : null,

    h('div', { class: 'qt-card-meta' },
      metaChip('award', `${setting.defaultPoints} балл.`),
      setting.minOptions !== null || setting.maxOptions !== null
        ? metaChip('list', `Вариантов: ${setting.minOptions ?? 0}–${setting.maxOptions ?? '∞'}`)
        : null,
      setting.requiresImage
        ? metaChip('image', 'Картинка обяз.')
        : null
    ),

    setting.allowedRoles.length > 0
      ? h('div', { class: 'qt-card-roles' },
          h('div', { class: 'qt-card-roles-label' }, 'Доступ:'),
          ...setting.allowedRoles.map((r) =>
            h('span', { class: 'badge badge-primary' }, ROLE_LABELS[r] ?? r)
          )
        )
      : null,

    h('div', { class: 'qt-card-actions' },
      h('button', {
        class: 'btn btn-secondary btn-sm',
        type: 'button',
        onclick: () => openEditModal(setting, onUpdate),
      },
        icon('edit-2', { size: 14, className: 'icon icon-sm' }),
        'Настройки'
      )
    )
  );
}

function metaChip(iconName: string, text: string): HTMLElement {
  return h('span', { class: 'qt-card-chip' },
    icon(iconName as never, { size: 12, className: 'icon icon-sm' }),
    text
  );
}

// ============================================================
// МОДАЛКА РЕДАКТИРОВАНИЯ ТИПА
// ============================================================

function openEditModal(setting: QuestionTypeSetting, onSuccess: () => void): void {
  const titleInput = h('input', {
    class: 'input',
    value: setting.title,
    placeholder: 'Название',
  }) as HTMLInputElement;

  const descInput = h('textarea', {
    class: 'textarea',
    placeholder: 'Описание для конструктора',
    rows: '2',
  }) as HTMLTextAreaElement;
  descInput.value = setting.description ?? '';

  const iconInput = h('input', {
    class: 'input',
    value: setting.icon ?? '',
    placeholder: 'hash, edit-2, check-circle, ...',
  }) as HTMLInputElement;

  const defaultPointsInput = h('input', {
    class: 'input',
    type: 'number',
    min: '0',
    max: '100',
    value: String(setting.defaultPoints),
  }) as HTMLInputElement;

  const minOptionsInput = h('input', {
    class: 'input',
    type: 'number',
    min: '0',
    max: '50',
    placeholder: '—',
    value: setting.minOptions !== null ? String(setting.minOptions) : '',
  }) as HTMLInputElement;

  const maxOptionsInput = h('input', {
    class: 'input',
    type: 'number',
    min: '1',
    max: '50',
    placeholder: '—',
    value: setting.maxOptions !== null ? String(setting.maxOptions) : '',
  }) as HTMLInputElement;

  const requiresImageInput = h('input', {
    type: 'checkbox',
    checked: setting.requiresImage,
  }) as HTMLInputElement;

  const sortOrderInput = h('input', {
    class: 'input',
    type: 'number',
    min: '0',
    max: '1000',
    value: String(setting.sortOrder),
  }) as HTMLInputElement;

  const roleCheckboxes: Record<string, HTMLInputElement> = {};
  const roleNodes: HTMLElement[] = [];
  for (const r of ['manager', 'curator', 'admin', 'superadmin']) {
    const cb = h('input', {
      type: 'checkbox',
      checked: setting.allowedRoles.includes(r),
    }) as HTMLInputElement;
    roleCheckboxes[r] = cb;
    roleNodes.push(
      h('label', { class: 'check' },
        cb,
        h('span', { class: 'check-box' }),
        h('span', null, ROLE_LABELS[r] ?? r)
      )
    );
  }

  const body = h('div', { class: 'stack' },
    h('div', { class: 'grid grid-2 gap-3' },
      h('div', { class: 'field', style: 'margin: 0;' },
        h('label', { class: 'field-label' }, 'Название'),
        titleInput
      ),
      h('div', { class: 'field', style: 'margin: 0;' },
        h('label', { class: 'field-label' }, 'Иконка (Feather)'),
        iconInput
      )
    ),
    h('div', { class: 'field' },
      h('label', { class: 'field-label' }, 'Описание'),
      descInput
    ),
    h('div', { class: 'grid grid-3 gap-3' },
      h('div', { class: 'field', style: 'margin: 0;' },
        h('label', { class: 'field-label' }, 'Баллы по умолч.'),
        defaultPointsInput
      ),
      h('div', { class: 'field', style: 'margin: 0;' },
        h('label', { class: 'field-label' }, 'Мин. вариантов'),
        minOptionsInput
      ),
      h('div', { class: 'field', style: 'margin: 0;' },
        h('label', { class: 'field-label' }, 'Макс. вариантов'),
        maxOptionsInput
      )
    ),
    h('div', { class: 'grid grid-2 gap-3' },
      h('div', { class: 'field', style: 'margin: 0;' },
        h('label', { class: 'field-label' }, 'Порядок в списке'),
        sortOrderInput
      ),
      h('div', { class: 'field', style: 'margin: 0;' },
        h('label', { class: 'field-label' }, 'Дополнительно'),
        h('label', { class: 'check mt-2' },
          requiresImageInput,
          h('span', { class: 'check-box' }),
          h('span', null, 'Требуется картинка')
        )
      )
    ),
    h('div', { class: 'field' },
      h('label', { class: 'field-label' }, 'Роли с доступом'),
      h('div', { class: 'column-tight' }, ...roleNodes)
    )
  );

  openModal({
    title: `Настройки: ${setting.title}`,
    body,
    size: 'lg',
    actions: [
      { label: 'Отмена', variant: 'secondary' },
      {
        label: 'Сохранить',
        variant: 'primary',
        onClick: async () => {
          const allowedRoles = Object.entries(roleCheckboxes)
            .filter(([, cb]) => cb.checked)
            .map(([r]) => r);

          try {
            await api.patch(`/questions/type-settings/${setting.type}`, {
              title: titleInput.value.trim(),
              description: descInput.value.trim() || undefined,
              icon: iconInput.value.trim() || undefined,
              defaultPoints: parseInt(defaultPointsInput.value, 10) || 0,
              minOptions: minOptionsInput.value ? parseInt(minOptionsInput.value, 10) : null,
              maxOptions: maxOptionsInput.value ? parseInt(maxOptionsInput.value, 10) : null,
              requiresImage: requiresImageInput.checked,
              sortOrder: parseInt(sortOrderInput.value, 10) || 0,
              allowedRoles,
            });
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