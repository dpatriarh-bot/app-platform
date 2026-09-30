// ============================================================
// pages/admin/points.ts — массовое начисление и корректировка
// + порционная загрузка childId с превью
// ============================================================

import { h, mount } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { api, isApiError } from '../../lib/api.js';
import { adminLayout, setRoot } from '../../components/layout.js';
import { loader } from '../../components/ui.js';
import { toastSuccess, toastError } from '../../lib/toast.js';

export async function renderAdminPoints(): Promise<void> {
  const root = h('div');

  setRoot(adminLayout({
    active: 'points',
    title: 'Баллы',
    subtitle: 'Массовое начисление и корректировка баланса',
    content: root,
  }));

  mount(root, loader());

  const deltaInput = h('input', {
    class: 'input',
    type: 'number',
    placeholder: 'Например, 50 или -30',
  }) as HTMLInputElement;

  const reasonInput = h('input', {
    class: 'input',
    placeholder: 'Причина (видна в аудите)',
  }) as HTMLInputElement;

  const childIdsInput = h('textarea', {
    class: 'textarea',
    placeholder: 'childId по одному на строку',
    style: 'min-height: 140px; font-family: var(--font-mono);',
  }) as HTMLTextAreaElement;

  const previewHost = h('div', { class: 'mt-3' });

  const submitBtn = h('button', {
    class: 'btn',
    type: 'button',
    onclick: async () => {
      const delta = parseInt(deltaInput.value, 10);
      const reason = reasonInput.value.trim();
      const ids = childIdsInput.value.split('\n').map((s) => s.trim()).filter(Boolean);

      if (!delta || delta === 0) {
        toastError('Введите ненулевое значение');
        return;
      }
      if (!reason || reason.length < 3) {
        toastError('Введите причину (мин. 3 символа)');
        return;
      }
      if (ids.length === 0) {
        toastError('Укажите хотя бы одного ребёнка');
        return;
      }

      try {
        const res = await api.post<{ affected: number }>('/admin/points/bulk-grant', {
          childIds: ids,
          delta,
          reason,
        });
        toastSuccess(`Обработано: ${res.affected}`);
        deltaInput.value = '';
        reasonInput.value = '';
        childIdsInput.value = '';
        mount(previewHost);
      } catch (err) {
        toastError(isApiError(err) ? err.message : 'Не удалось');
      }
    },
  },
    icon('award', { size: 18 }),
    'Начислить / списать'
  );

  // Превью при вводе
  childIdsInput.addEventListener('blur', () => {
    const ids = childIdsInput.value.split('\n').map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) {
      mount(previewHost);
      return;
    }

    mount(previewHost,
      h('div', { class: 'alert alert-info' },
        icon('info', { size: 18, className: 'icon icon-sm alert-icon' }),
        h('div', null,
          h('div', { class: 'alert-title' }, `Найдено ID: ${ids.length}`),
          ids.length > 20
            ? `Будет обработано ${ids.length} детей. Проверьте, что все ID корректны.`
            : ids.join(', ')
        )
      )
    );
  });

  const content = h('div', { class: 'stack-lg anim-slide-up' },
    h('div', { class: 'card card-pad-lg' },
      h('h3', null, 'Массовая операция'),
      h('p', { class: 'text-sm text-muted mt-2 mb-5' },
        'Положительное значение — начисление, отрицательное — списание. Все операции пишутся в аудит.'
      ),
      h('div', { class: 'field' },
        h('label', { class: 'field-label' }, 'Значение (баллы)'),
        deltaInput
      ),
      h('div', { class: 'field' },
        h('label', { class: 'field-label' }, 'Причина'),
        reasonInput
      ),
      h('div', { class: 'field' },
        h('label', { class: 'field-label' }, 'ID детей (по одному на строку)'),
        childIdsInput,
        h('div', { class: 'field-hint' },
          'Можно вставить список ID из буфера. Проверьте превью перед отправкой.'
        )
      ),
      previewHost,
      h('div', { class: 'mt-5' }, submitBtn)
    ),

    h('div', { class: 'alert alert-info' },
      icon('info', { size: 18, className: 'icon icon-sm alert-icon' }),
      h('div', null,
        h('div', { class: 'alert-title' }, 'Как получить childId'),
        'Откройте карточку родителя в разделе «Пользователи». ID ребёнка виден в блоке «Дети». ' +
        'Также можно скопировать ID из адресной строки при просмотре попытки или результата.'
      )
    )
  );

  mount(root, content);
}