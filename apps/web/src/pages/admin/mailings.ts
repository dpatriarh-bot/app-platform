// ============================================================
// pages/admin/mailings.ts — рассылки и шаблоны
// ============================================================

import { h, mount, clear } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { api, isApiError } from '../../lib/api.js';
import { router } from '../../lib/router.js';
import { adminLayout, setRoot } from '../../components/layout.js';
import { emptyState, loader, statusBadge, pillsTabs } from '../../components/ui.js';
import { openModal, confirmModal } from '../../lib/modal.js';
import { toastSuccess, toastError } from '../../lib/toast.js';
import { formatDateTime } from '../../lib/format.js';

type Tab = 'mailings' | 'templates';

interface MailingItem {
  id: string;
  name: string;
  channel: string;
  status: string;
  subject: string | null;
  templateId: string | null;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  scheduledAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

interface TemplateItem {
  id: string;
  code: string;
  name: string;
  subject: string;
  bodyHtml: string;
  bodyText: string | null;
  variables: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function renderAdminMailings(): Promise<void> {
  const currentTab = getTabFromUrl();

  const root = h('div');

  setRoot(adminLayout({
    active: 'mailings',
    title: 'Рассылки',
    content: root,
  }));

  mount(root, loader());

  try {
    const tabsEl = pillsTabs([
      { key: 'mailings', label: 'Рассылки', active: currentTab === 'mailings', onClick: () => navigateTab('mailings') },
      { key: 'templates', label: 'Шаблоны', active: currentTab === 'templates', onClick: () => navigateTab('templates') },
    ]);

    const contentHost = h('div', { class: 'anim-slide-up delay-1' });

    const renderTab = async (): Promise<void> => {
      mount(contentHost, loader());
      const tab = getTabFromUrl();
      if (tab === 'mailings') await renderMailingsTab(contentHost);
      else await renderTemplatesTab(contentHost);
    };

    const content = h('div', { class: 'stack-lg' },
      h('div', { style: 'display: flex; justify-content: center;' }, tabsEl),
      contentHost
    );

    mount(root, content);
    await renderTab();

    window.addEventListener('hashchange', () => void renderTab());
  } catch (err) {
    mount(root, emptyState({
      illustration: 'error',
      title: 'Не удалось загрузить',
    }));
  }
}

function getTabFromUrl(): Tab {
  const hash = window.location.hash;
  const qIdx = hash.indexOf('?');
  if (qIdx === -1) return 'mailings';
  const params = new URLSearchParams(hash.slice(qIdx + 1));
  return params.get('tab') === 'templates' ? 'templates' : 'mailings';
}

function navigateTab(tab: Tab): void {
  router.navigate(`/admin/mailings?tab=${tab}`);
}

// ============================================================
// MAILINGS TAB
// ============================================================

async function renderMailingsTab(host: HTMLElement): Promise<void> {
  try {
    const res = await api.get<{ items: MailingItem[]; total: number }>('/mailings?limit=100');

    const createBtn = h('button', {
      class: 'btn',
      type: 'button',
      onclick: () => openCreateMailingModal(() => router.reload()),
    },
      icon('plus', { size: 18 }),
      'Новая рассылка'
    );

    if (res.items.length === 0) {
      mount(host,
        h('div', { class: 'stack' },
          h('div', { class: 'row-between' }, h('h3', null, 'Рассылки'), createBtn),
          emptyState({
            illustration: 'no-notifications',
            title: 'Рассылок пока нет',
            description: 'Создайте первую рассылку по сегменту пользователей.',
          })
        )
      );
      return;
    }

    mount(host,
      h('div', { class: 'stack' },
        h('div', { class: 'row-between' }, h('h3', null, 'Рассылки'), createBtn),
        h('div', { class: 'card' },
          h('div', { class: 'table-wrap', style: 'border: 0; border-radius: var(--r-lg);' },
            h('table', { class: 'table' },
              h('thead', null,
                h('tr', null,
                  h('th', null, 'Название'),
                  h('th', null, 'Канал'),
                  h('th', null, 'Статус'),
                  h('th', null, 'Получатели'),
                  h('th', null, 'Отправлено'),
                  h('th', null, 'Создана'),
                  h('th', null, '')
                )
              ),
              h('tbody', null,
                ...res.items.map((m) =>
                  h('tr', null,
                    h('td', { class: 'fw-600' }, m.name),
                    h('td', null, h('span', { class: 'badge' }, m.channel)),
                    h('td', null, statusBadge(m.status)),
                    h('td', null, String(m.totalRecipients)),
                    h('td', null,
                      `${m.sentCount}`,
                      m.failedCount > 0
                        ? h('span', { class: 'text-xs text-muted', style: 'margin-left: 4px;' },
                            `(${m.failedCount} ошибок)`
                          )
                        : null
                    ),
                    h('td', { class: 'text-sm text-muted nowrap' }, formatDateTime(m.createdAt)),
                    h('td', null,
                      h('div', { class: 'row gap-1' },
                        (m.status === 'draft' || m.status === 'scheduled') && h('button', {
                          class: 'btn btn-ghost btn-sm',
                          type: 'button',
                          onclick: async () => {
                            const ok = await confirmModal({
                              title: 'Отправить рассылку?',
                              message: `Получателей: ${m.totalRecipients}.`,
                              confirmLabel: 'Отправить',
                            });
                            if (!ok) return;
                            try {
                              await api.post(`/mailings/${m.id}/send`, {});
                              toastSuccess('Отправляется...');
                              router.reload();
                            } catch (err) {
                              toastError(isApiError(err) ? err.message : 'Ошибка');
                            }
                          },
                        }, 'Отправить'),
                        (m.status === 'draft' || m.status === 'scheduled') && h('button', {
                          class: 'btn btn-ghost btn-icon btn-sm',
                          type: 'button',
                          title: 'Отменить',
                          onclick: async () => {
                            try {
                              await api.post(`/mailings/${m.id}/cancel`, {});
                              toastSuccess('Отменено');
                              router.reload();
                            } catch (err) {
                              toastError(isApiError(err) ? err.message : 'Ошибка');
                            }
                          },
                        }, icon('x', { size: 16, className: 'icon icon-sm' }))
                      )
                    )
                  )
                )
              )
            )
          )
        )
      )
    );
  } catch {
    mount(host, emptyState({
      illustration: 'error',
      title: 'Не удалось загрузить',
    }));
  }
}

// ============================================================
// TEMPLATES TAB
// ============================================================

async function renderTemplatesTab(host: HTMLElement): Promise<void> {
  try {
    const res = await api.get<{ items: TemplateItem[] }>('/mailings/templates');

    const createBtn = h('button', {
      class: 'btn',
      type: 'button',
      onclick: () => openTemplateModal(null, () => router.reload()),
    },
      icon('plus', { size: 18 }),
      'Новый шаблон'
    );

    if (res.items.length === 0) {
      mount(host,
        h('div', { class: 'stack' },
          h('div', { class: 'row-between' }, h('h3', null, 'Шаблоны'), createBtn),
          emptyState({
            illustration: 'empty',
            title: 'Шаблонов пока нет',
            description: 'Создайте первый шаблон для рассылок.',
          })
        )
      );
      return;
    }

    mount(host,
      h('div', { class: 'stack' },
        h('div', { class: 'row-between' }, h('h3', null, 'Шаблоны'), createBtn),
        h('div', { class: 'grid grid-auto-320 stagger' },
          ...res.items.map((t) =>
            h('div', { class: 'card card-pad stagger-item' },
              h('div', { class: 'row-between' },
                h('div', null,
                  h('div', { class: 'fw-700' }, t.name),
                  h('div', { class: 'text-xs text-muted mt-1' }, `#${t.code}`)
                ),
                t.isActive
                  ? h('span', { class: 'badge badge-success' }, 'Вкл')
                  : h('span', { class: 'badge' }, 'Выкл')
              ),
              h('div', { class: 'text-sm text-muted mt-3' }, t.subject),
              t.variables.length > 0
                ? h('div', { class: 'row row-wrap gap-1 mt-3' },
                    ...t.variables.map((v) => h('span', { class: 'badge' }, `{{${v}}}`))
                  )
                : null,
              h('div', { class: 'row gap-2 mt-4' },
                h('button', {
                  class: 'btn btn-secondary btn-sm',
                  type: 'button',
                  onclick: () => openTemplateModal(t, () => router.reload()),
                },
                  icon('edit-2', { size: 14, className: 'icon icon-sm' }),
                  'Редактировать'
                )
              )
            )
          )
        )
      )
    );
  } catch {
    mount(host, emptyState({
      illustration: 'error',
      title: 'Не удалось загрузить',
    }));
  }
}

function openTemplateModal(tpl: TemplateItem | null, onSuccess: () => void): void {
  const isEdit = tpl !== null;

  const codeInput = h('input', {
    class: 'input',
    placeholder: 'welcome',
    value: tpl?.code ?? '',
  }) as HTMLInputElement;

  const nameInput = h('input', {
    class: 'input',
    placeholder: 'Приветствие',
    value: tpl?.name ?? '',
  }) as HTMLInputElement;

  const subjectInput = h('input', {
    class: 'input',
    placeholder: 'Тема письма',
    value: tpl?.subject ?? '',
  }) as HTMLInputElement;

  const bodyInput = h('textarea', {
    class: 'textarea',
    style: 'min-height: 200px; font-family: var(--font-mono); font-size: 13px;',
    placeholder: '<p>Здравствуйте, {{parentName}}!</p>',
  }) as HTMLTextAreaElement;
  bodyInput.value = tpl?.bodyHtml ?? '';

  const varsInput = h('input', {
    class: 'input',
    placeholder: 'parentName, planName',
    value: (tpl?.variables ?? []).join(', '),
  }) as HTMLInputElement;

  const body = h('div', { class: 'stack' },
    h('div', { class: 'field' },
      h('label', { class: 'field-label' }, 'Код ', h('span', { class: 'req' }, '*')),
      codeInput
    ),
    h('div', { class: 'field' },
      h('label', { class: 'field-label' }, 'Название'),
      nameInput
    ),
    h('div', { class: 'field' },
      h('label', { class: 'field-label' }, 'Тема письма'),
      subjectInput
    ),
    h('div', { class: 'field' },
      h('label', { class: 'field-label' }, 'HTML-тело'),
      bodyInput
    ),
    h('div', { class: 'field' },
      h('label', { class: 'field-label' }, 'Переменные'),
      varsInput
    )
  );

  openModal({
    title: isEdit ? 'Редактировать шаблон' : 'Новый шаблон',
    body,
    size: 'lg',
    actions: [
      { label: 'Отмена', variant: 'secondary' },
      {
        label: isEdit ? 'Сохранить' : 'Создать',
        variant: 'primary',
        onClick: async () => {
          if (!codeInput.value.trim() || !nameInput.value.trim() ||
              !subjectInput.value.trim() || !bodyInput.value.trim()) {
            toastError('Заполните обязательные поля');
            return false;
          }

          const payload = {
            code: codeInput.value.trim(),
            name: nameInput.value.trim(),
            subject: subjectInput.value.trim(),
            bodyHtml: bodyInput.value,
            variables: varsInput.value.split(',').map((v) => v.trim()).filter(Boolean),
          };

          try {
            if (isEdit && tpl) {
              const { code: _code, ...updatePayload } = payload;
              await api.patch(`/mailings/templates/${tpl.id}`, updatePayload);
              toastSuccess('Обновлено');
            } else {
              await api.post('/mailings/templates', payload);
              toastSuccess('Создано');
            }
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

function openCreateMailingModal(onSuccess: () => void): void {
  const nameInput = h('input', { class: 'input', placeholder: 'Название' }) as HTMLInputElement;
  const channelSelect = h('select', { class: 'select' }) as HTMLSelectElement;
  channelSelect.appendChild(h('option', { value: 'email' }, 'Email'));
  channelSelect.appendChild(h('option', { value: 'sms' }, 'SMS'));

  const templateSelect = h('select', { class: 'select' }) as HTMLSelectElement;
  templateSelect.appendChild(h('option', { value: '' }, 'Без шаблона'));

  const subjectInput = h('input', { class: 'input', placeholder: 'Тема' }) as HTMLInputElement;
  const bodyInput = h('textarea', {
    class: 'textarea',
    placeholder: 'HTML или текст',
    style: 'min-height: 160px;',
  }) as HTMLTextAreaElement;

  const rolesInput = h('input', {
    class: 'input',
    placeholder: 'parent (через запятую)',
  }) as HTMLInputElement;
  rolesInput.value = 'parent';

  const previewHost = h('div');

  void (async () => {
    try {
      const t = await api.get<{ items: TemplateItem[] }>('/mailings/templates');
      for (const tpl of t.items) {
        templateSelect.appendChild(h('option', { value: tpl.id }, tpl.name));
      }
    } catch {
      // ignore
    }
  })();

  const previewBtn = h('button', {
    class: 'btn btn-secondary btn-sm',
    type: 'button',
    onclick: async () => {
      try {
        const res = await api.post<{ total: number; sample: Array<{ email: string; fullName: string }> }>(
          '/mailings/segment/preview',
          {
            segment: { roles: rolesInput.value.split(',').map((s) => s.trim()).filter(Boolean) },
            limit: 5,
          }
        );
        mount(previewHost,
          h('div', { class: 'alert alert-info mt-3' },
            h('div', null,
              h('div', { class: 'alert-title' }, `Получателей: ${res.total}`),
              ...res.sample.slice(0, 3).map((s) =>
                h('div', { class: 'text-xs mt-1' }, `${s.fullName} <${s.email}>`)
              )
            )
          )
        );
      } catch (err) {
        toastError(isApiError(err) ? err.message : 'Не удалось получить превью');
      }
    },
  }, 'Предпросмотр');

  const body = h('div', { class: 'stack' },
    h('div', { class: 'field' },
      h('label', { class: 'field-label' }, 'Название'),
      nameInput
    ),
    h('div', { class: 'grid grid-2 gap-3' },
      h('div', { class: 'field', style: 'margin: 0;' },
        h('label', { class: 'field-label' }, 'Канал'),
        channelSelect
      ),
      h('div', { class: 'field', style: 'margin: 0;' },
        h('label', { class: 'field-label' }, 'Шаблон'),
        templateSelect
      )
    ),
    h('div', { class: 'field' },
      h('label', { class: 'field-label' }, 'Тема (если без шаблона)'),
      subjectInput
    ),
    h('div', { class: 'field' },
      h('label', { class: 'field-label' }, 'Тело (если без шаблона)'),
      bodyInput
    ),
    h('div', { class: 'field' },
      h('label', { class: 'field-label' }, 'Роли получателей'),
      rolesInput,
      h('div', { class: 'row mt-2' }, previewBtn)
    ),
    previewHost
  );

  openModal({
    title: 'Новая рассылка',
    body,
    size: 'lg',
    actions: [
      { label: 'Отмена', variant: 'secondary' },
      {
        label: 'Создать',
        variant: 'primary',
        onClick: async () => {
          if (!nameInput.value.trim()) {
            toastError('Введите название');
            return false;
          }
          try {
            await api.post('/mailings', {
              name: nameInput.value.trim(),
              channel: channelSelect.value,
              templateId: templateSelect.value || undefined,
              subject: subjectInput.value.trim() || undefined,
              bodyHtml: bodyInput.value.trim() || undefined,
              segment: {
                roles: rolesInput.value.split(',').map((s) => s.trim()).filter(Boolean),
              },
            });
            toastSuccess('Рассылка создана');
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