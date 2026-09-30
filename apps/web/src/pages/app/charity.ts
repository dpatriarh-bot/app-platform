// ============================================================
// pages/app/charity.ts — благотворительность с кешбэком
// ============================================================

import { h, mount } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { api, isApiError } from '../../lib/api.js';
import { store } from '../../lib/store.js';
import { router } from '../../lib/router.js';
import { appLayout, setRoot } from '../../components/layout.js';
import { emptyState, loader, statusBadge } from '../../components/ui.js';
import { toastSuccess, toastError } from '../../lib/toast.js';
import { formatDateShort, formatMoney, formatNumber } from '../../lib/format.js';

interface CharitySettings {
  sharePercent: number;
  cashbackPercent: number;
  title: string;
  description: string | null;
  fundName: string | null;
  fundUrl: string | null;
}

interface CharityStats {
  totalDonationsRub: number;
  totalCashbackRub: number;
  donorsCount: number;
  sharePercent: number;
  cashbackPercent: number;
}

interface DonationItem {
  id: string;
  amountRub: number;
  cashbackRub: number;
  cashbackPoints: number;
  status: string;
  provider: string;
  paidAt: string | null;
  createdAt: string;
}

export async function renderAppCharity(): Promise<void> {
  const root = h('div');
  setRoot(appLayout({
    active: 'charity',
    title: 'Помочь детям',
    subtitle: 'Пожертвование с кешбэком трудокоинами',
    content: root,
  }));
  mount(root, loader());

  try {
    const [settingsRes, statsRes, donationsRes] = await Promise.all([
      api.get<CharitySettings>('/charity/settings'),
      api.get<CharityStats>('/charity/stats'),
      api.get<{ items: DonationItem[]; total: number }>('/charity/donations?limit=20'),
    ]);

    const content = h('div', { class: 'stack-lg charity-page' },
      renderHero(settingsRes),
      renderStats(statsRes),
      renderDonateForm(settingsRes),
      renderHistory(donationsRes.items)
    );

    mount(root, content);
  } catch (err) {
    mount(root, emptyState({
      illustration: 'error',
      title: 'Не удалось загрузить раздел',
      description: isApiError(err) ? err.message : 'Попробуйте позже',
      action: h('button', {
        class: 'btn',
        type: 'button',
        onclick: () => router.reload(),
      }, 'Обновить'),
    }));
  }
}

function renderHero(s: CharitySettings): HTMLElement {
  return h('div', {
    class: 'card card-pad-lg anim-slide-up charity-hero',
  },
    h('div', { class: 'charity-hero-icon' },
      icon('heart', { size: 48, className: 'icon icon-2xl' })
    ),
    h('h1', { class: 'charity-hero-title' }, s.title),
    s.description
      ? h('p', { class: 'charity-hero-text' }, s.description)
      : null,
    h('div', { class: 'charity-hero-badges' },
      h('span', { class: 'charity-hero-badge' },
        `Кешбэк ${s.cashbackPercent}% в трудокинах`
      ),
      s.fundName
        ? h('span', { class: 'charity-hero-badge' }, s.fundName)
        : null
    )
  );
}

function renderStats(s: CharityStats): HTMLElement {
  return h('div', { class: 'stat-grid-admin charity-stats stagger' },
    statCard('Собрано', formatMoney(s.totalDonationsRub), 'Пожертвования'),
    statCard('Кешбэк', formatMoney(s.totalCashbackRub), 'Вернули родителям'),
    statCard('Донатеров', formatNumber(s.donorsCount), 'Активных участников')
  );
}

function statCard(label: string, value: string, hint: string): HTMLElement {
  return h('div', { class: 'stat-card stagger-item charity-stat-card' },
    h('div', { class: 'stat-label' }, label),
    h('div', { class: 'stat-value' }, value),
    h('div', { class: 'stat-hint' }, hint)
  );
}

function renderDonateForm(s: CharitySettings): HTMLElement {
  const children = store.getState().children;
  const currentChildId = store.getState().currentChildId;

  const amountInput = h('input', {
    class: 'input charity-amount-input',
    type: 'number',
    min: '100',
    max: '500000',
    step: '100',
    value: '500',
  }) as HTMLInputElement;

  const quickHost = h('div', { class: 'charity-quick-amounts' });

  const previewHost = h('div', { class: 'alert alert-info charity-cashback-preview' });

  const updatePreview = (): void => {
    const amount = parseInt(amountInput.value, 10) || 0;
    const cashbackRub = Math.floor((amount * s.cashbackPercent) / 100);

    previewHost.replaceChildren(
      icon('award', { size: 18, className: 'icon icon-sm alert-icon' }),
      h('div', null,
        h('div', { class: 'alert-title' }, `Кешбэк: ${formatMoney(cashbackRub)}`),
        `Вернём ${cashbackRub} трудокоинов на баланс ребёнка`
      )
    );
  };

  for (const v of [300, 500, 1000, 2500, 5000]) {
    quickHost.appendChild(
      h('button', {
        class: 'chip charity-quick-amount',
        type: 'button',
        onclick: () => {
          amountInput.value = String(v);
          updatePreview();
        },
      }, `${v} ₽`)
    );
  }

  amountInput.addEventListener('input', updatePreview);

  const childSelect = h('select', { class: 'select' }) as HTMLSelectElement;
  childSelect.appendChild(h('option', { value: '' }, '— без привязки к ребёнку —'));
  for (const c of children) {
    childSelect.appendChild(h('option', {
      value: c.id,
      selected: c.id === currentChildId,
    }, c.fullName));
  }

  const submitBtn = h('button', {
    class: 'btn btn-lg btn-block charity-submit-btn',
    type: 'button',
    onclick: async () => {
      const amount = parseInt(amountInput.value, 10);
      if (!amount || amount < 100) {
        toastError('Минимальная сумма — 100 ₽');
        return;
      }
      if (amount > 500000) {
        toastError('Максимальная сумма — 500 000 ₽');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.classList.add('btn-loading');

      try {
        const res = await api.post<{ donation: DonationItem }>('/charity/donate', {
          amountRub: amount,
          childId: childSelect.value || undefined,
        });

        toastSuccess(`Спасибо! Пожертвование ${formatMoney(amount)} принято`);
        void res;
        router.reload();
      } catch (err) {
        toastError(isApiError(err) ? err.message : 'Не удалось отправить');
        submitBtn.disabled = false;
        submitBtn.classList.remove('btn-loading');
      }
    },
  },
    icon('heart', { size: 20 }),
    'Пожертвовать'
  );

  updatePreview();

  return h('div', { class: 'card card-pad-lg anim-slide-up delay-1 charity-form-card' },
    h('h2', { class: 'section-title-mobile mb-5' }, 'Сделать пожертвование'),
    h('div', { class: 'stack charity-form' },
      h('div', { class: 'field' },
        h('label', { class: 'field-label' }, 'Сумма, ₽'),
        amountInput
      ),
      quickHost,
      previewHost,
      h('div', { class: 'field' },
        h('label', { class: 'field-label' }, 'Привязать кешбэк к ребёнку'),
        childSelect,
        h('div', { class: 'field-hint' },
          'Трудокоины будут начислены на баланс выбранного ребёнка'
        )
      ),
      submitBtn
    )
  );
}

function renderHistory(items: DonationItem[]): HTMLElement {
  if (items.length === 0) {
    return h('div', { class: 'anim-slide-up delay-2 charity-history' },
      h('h3', { class: 'section-title-mobile mb-4' }, 'История'),
      emptyState({
        illustration: 'empty',
        title: 'Пожертвований пока нет',
        description: 'Ваша первая помощь появится здесь.',
      })
    );
  }

  return h('div', { class: 'anim-slide-up delay-2 charity-history' },
    h('h3', { class: 'section-title-mobile mb-4' }, 'История'),
    h('div', { class: 'stack stagger charity-history-list' },
      ...items.map((d) =>
        h('div', { class: 'card card-pad stagger-item charity-history-item' },
          h('div', { class: 'row-between row-wrap gap-3' },
            h('div', { class: 'grow', style: 'min-width: 0;' },
              h('div', { class: 'fw-700' }, formatMoney(d.amountRub)),
              h('div', { class: 'text-xs text-muted mt-1' },
                formatDateShort(d.paidAt ?? d.createdAt)
              )
            ),
            statusBadge(d.status)
          ),
          d.cashbackPoints > 0
            ? h('div', { class: 'mt-3' },
                h('span', { class: 'badge badge-primary' },
                  icon('award', { size: 12, className: 'icon icon-sm' }),
                  `Кешбэк: +${d.cashbackPoints} трудокоинов`
                )
              )
            : null
        )
      )
    )
  );
}