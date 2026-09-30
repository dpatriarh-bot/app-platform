// ============================================================
// pages/app/payments.ts — управление подпиской + 3 тарифа
// + баннер 80% на благотворительность.
// ============================================================

import { h, mount } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { api, isApiError } from '../../lib/api.js';
import { store } from '../../lib/store.js';
import { router } from '../../lib/router.js';
import { appLayout, setRoot } from '../../components/layout.js';
import { emptyState, loader, statusBadge } from '../../components/ui.js';
import { confirmModal } from '../../lib/modal.js';
import { toastSuccess, toastError } from '../../lib/toast.js';
import { formatDate, formatMoney } from '../../lib/format.js';

interface PlanItem {
  id: string;
  code: string;
  name: string;
  priceRub: number;
  periodDays: number;
  isDefault: boolean;
}

interface SubscriptionData {
  id: string;
  status: string;
  planName: string;
  priceRub: number;
  periodDays: number;
  daysLeft: number | null;
  autoRenew: boolean;
  currentPeriodEnd: string | null;
  canceledAt: string | null;
}

interface PaymentItem {
  id: string;
  amountRub: number;
  currency: string;
  status: string;
  isRecurrent: boolean;
  isTest: boolean;
  receiptUrl: string | null;
  failureReason: string | null;
  paidAt: string | null;
  createdAt: string;
}

interface SubscribeResponse {
  subscription: SubscriptionData;
  payment: {
    id: string;
    amountRub: number;
    status: string;
    confirmationUrl: string | null;
  };
}

export async function renderAppPayments(): Promise<void> {
  const root = h('div');
  setRoot(appLayout({
    active: 'payments',
    title: 'Подписка и платежи',
    subtitle: 'Управление автопродлением и история списаний',
    content: root,
  }));
  mount(root, loader());

  try {
    const [subRes, plansRes, historyRes] = await Promise.all([
      api.get<{ subscription: SubscriptionData | null }>('/payments/subscription'),
      api.get<{ plans: PlanItem[] }>('/payments/plans'),
      api.get<{ items: PaymentItem[]; total: number }>('/payments/history?limit=50'),
    ]);

    const subscription = subRes.subscription;
    const plans = plansRes.plans;
    const payments = historyRes.items;

    store.setState({
      subscription: subscription
        ? {
            status: subscription.status,
            planName: subscription.planName,
            priceRub: subscription.priceRub,
            daysLeft: subscription.daysLeft,
            autoRenew: subscription.autoRenew,
          }
        : null,
    });

    const content = h('div', { class: 'stack-lg' },
      renderCharityNote(),
      subscription ? renderSubscriptionCard(subscription) : renderPaywall(plans),
      subscription ? null : renderPlansSection(plans),
      renderHistory(payments)
    );

    mount(root, content);
  } catch {
    mount(root, emptyState({
      illustration: 'error',
      title: 'Не удалось загрузить данные',
      action: h('button', {
        class: 'btn',
        type: 'button',
        onclick: () => router.reload(),
      }, 'Обновить'),
    }));
  }
}

function renderCharityNote(): HTMLElement {
  return h('div', {
    class: 'card card-pad anim-slide-up',
    style: 'background: linear-gradient(135deg, #F2867D 0%, #E8C77A 100%); color: #FFFFFF; border: 0;',
  },
    h('div', { class: 'row gap-3', style: 'align-items: flex-start;' },
      icon('heart', { size: 32, className: 'icon icon-lg' }),
      h('div', { class: 'grow', style: 'min-width: 0;' },
        h('div', { class: 'fw-800', style: 'font-size: var(--fz-lg);' },
          '80% от каждой оплаты — на благотворительность'
        ),
        h('div', { style: 'opacity: 0.95; margin-top: 6px; font-size: var(--fz-sm); line-height: 1.5;' },
          'Мы перечисляем 80% от стоимости подписки в благотворительный фонд «Улыбка детям». ' +
          'Ваша подписка помогает не только вашему ребёнку.'
        )
      )
    )
  );
}

async function handleSubscribe(planCode: string, onDone: () => void): Promise<void> {
  try {
    const res = await api.post<SubscribeResponse>('/payments/subscribe', { planCode });

    if (res.payment.confirmationUrl) {
      window.location.href = res.payment.confirmationUrl;
      return;
    }

    toastSuccess('Подписка оформлена');
    onDone();
  } catch (err) {
    toastError(isApiError(err) ? err.message : 'Не удалось оформить');
  }
}

function renderSubscriptionCard(sub: SubscriptionData): HTMLElement {
  const cancelBtn = sub.autoRenew && sub.status === 'active'
    ? h('button', {
        class: 'btn btn-secondary btn-block-mobile',
        type: 'button',
        onclick: async () => {
          const ok = await confirmModal({
            title: 'Отключить автопродление?',
            message: 'Подписка останется активной до конца текущего периода.',
            confirmLabel: 'Отключить',
          });
          if (!ok) return;
          try {
            await api.post('/payments/cancel', {});
            toastSuccess('Автопродление отключено');
            router.reload();
          } catch (err) {
            toastError(isApiError(err) ? err.message : 'Не удалось отключить');
          }
        },
      }, 'Отключить автопродление')
    : null;

  const resumeBtn = !sub.autoRenew && sub.status === 'active'
    ? h('button', {
        class: 'btn btn-block-mobile',
        type: 'button',
        onclick: async () => {
          try {
            await api.post('/payments/resume', {});
            toastSuccess('Автопродление включено');
            router.reload();
          } catch (err) {
            toastError(isApiError(err) ? err.message : 'Не удалось включить');
          }
        },
      },
        icon('refresh-cw', { size: 18 }),
        'Возобновить'
      )
    : null;

  return h('div', { class: 'payment-card anim-slide-up' },
    h('div', { class: 'row-between mb-5 row-wrap gap-3' },
      h('div', { class: 'grow', style: 'min-width: 0;' },
        h('div', { class: 'text-xs text-muted' }, 'Текущая подписка'),
        h('h2', { class: 'payment-plan-name' }, sub.planName)
      ),
      statusBadge(sub.status)
    ),

    h('div', { class: 'info-grid-mobile', style: 'margin-bottom: var(--sp-5);' },
      renderInfoBlock('Стоимость', `${formatMoney(sub.priceRub)} / период`),
      renderInfoBlock('Период', `${sub.periodDays} дней`),
      sub.daysLeft !== null
        ? renderInfoBlock('Осталось', `${sub.daysLeft} дн.`)
        : null,
      sub.currentPeriodEnd
        ? renderInfoBlock('Действует до', formatDate(sub.currentPeriodEnd))
        : null,
      renderInfoBlock('Автопродление', sub.autoRenew ? 'Включено' : 'Отключено')
    ),

    h('div', { class: 'actions-mobile' },
      resumeBtn,
      cancelBtn
    )
  );
}

function renderInfoBlock(label: string, value: string): HTMLElement {
  return h('div', { class: 'info-block-mobile' },
    h('div', { class: 'text-xs text-muted' }, label),
    h('div', { class: 'fw-700 mt-1' }, value)
  );
}

function renderPaywall(plans: PlanItem[]): HTMLElement {
  const best = plans.find((p) => p.code === 'yearly') ?? plans[0];

  return h('div', {
    class: 'payment-card anim-slide-up',
    style: 'text-align: center; background: linear-gradient(135deg, var(--c-primary-50) 0%, var(--c-surface) 100%); border-color: var(--c-primary); border-width: 2px;',
  },
    h('div', {
      class: 'feature-icon',
      style: 'margin: 0 auto var(--sp-5); width: 64px; height: 64px;',
    }, icon('credit-card', { size: 28 })),
    h('h2', { style: 'font-size: var(--fz-2xl);' }, 'Оформите подписку'),
    h('p', { class: 'text-muted mt-3', style: 'max-width: 420px; margin-left: auto; margin-right: auto;' },
      'Три тарифа на выбор. Чем дольше период — тем ниже цена за месяц.'
    ),
    best
      ? h('div', { class: 'paywall-price' },
          `${best.priceRub} ₽`,
          h('span', { class: 'paywall-period' },
            best.code === 'yearly' ? '/ год' :
            best.code === 'quarterly' ? '/ 3 мес.' : '/ месяц'
          )
        )
      : null,
    h('div', { class: 'text-sm text-muted mb-5' },
      'От 141 ₽ в месяц при годовой оплате'
    ),
    h('div', { class: 'stack-sm', style: 'max-width: 420px; margin: 0 auto;' },
      ...plans.map((p) =>
        h('button', {
          class: `btn ${p.code === 'yearly' ? '' : 'btn-secondary'} btn-block`,
          type: 'button',
          onclick: () => handleSubscribe(p.code, () => router.reload()),
        },
          h('span', { class: 'grow' }, p.name),
          h('span', { class: 'fw-700' }, `${p.priceRub} ₽`)
        )
      )
    )
  );
}

function renderPlansSection(plans: PlanItem[]): HTMLElement {
  return h('div', { class: 'anim-slide-up delay-1' },
    h('h3', { class: 'section-title-mobile mb-4' }, 'Сравнение тарифов'),
    h('div', { class: 'grid grid-auto-280' },
      ...plans.map((p) => {
        const perMonth = Math.round(p.priceRub / (p.periodDays / 30));
        const monthly190 = 190;
        const discount = p.periodDays > 30
          ? Math.round((1 - perMonth / monthly190) * 100)
          : 0;

        return h('div', {
          class: `card card-pad ${p.code === 'yearly' ? '' : ''}`,
          style: p.code === 'yearly' ? 'border-color: var(--c-primary); border-width: 2px;' : '',
        },
          p.code === 'yearly'
            ? h('span', { class: 'badge badge-primary mb-3' }, 'Рекомендуем')
            : p.code === 'quarterly'
              ? h('span', { class: 'badge badge-warning mb-3' }, 'Выгодно')
              : null,
          h('div', { class: 'fw-800', style: 'font-size: var(--fz-xl);' }, p.name),
          h('div', { class: 'mt-3', style: 'font-size: 32px; font-weight: 900; letter-spacing: -0.03em;' },
            `${p.priceRub} ₽`
          ),
          h('div', { class: 'text-sm text-muted mt-1' },
            `${perMonth} ₽ / месяц`,
            discount > 0
              ? h('span', { class: 'badge badge-success ml-2' }, `−${discount}%`)
              : null
          ),
          h('hr', { class: 'divider' }),
          h('ul', { class: 'tariff-list' },
            ...[
              'Все тесты',
              'Автопроверка',
              'Трудокоины',
              'Подарки',
              'Ачивки',
              'Антифрод',
            ].map((t) =>
              h('li', { class: 'tariff-list-item' },
                icon('check-circle', { size: 18, className: 'icon icon-sm' }),
                h('span', null, t)
              )
            )
          ),
          h('button', {
            class: `btn btn-block ${p.code === 'yearly' ? '' : 'btn-secondary'}`,
            type: 'button',
            onclick: () => handleSubscribe(p.code, () => router.reload()),
          }, 'Выбрать')
        );
      })
    )
  );
}

function renderHistory(payments: PaymentItem[]): HTMLElement {
  if (payments.length === 0) {
    return h('div', { class: 'anim-slide-up delay-1' },
      h('h2', { class: 'section-title-mobile mb-4' }, 'История платежей'),
      emptyState({
        illustration: 'empty',
        title: 'Платежей пока нет',
      })
    );
  }

  return h('div', { class: 'anim-slide-up delay-1' },
    h('h2', { class: 'section-title-mobile mb-4' }, 'История платежей'),
    h('div', { class: 'payments-list-mobile stagger' },
      ...payments.map((p) => renderPaymentRow(p))
    )
  );
}

function renderPaymentRow(p: PaymentItem): HTMLElement {
  return h('div', { class: 'payment-row-mobile stagger-item' },
    h('div', { class: 'row-between row-wrap gap-2' },
      h('div', { class: 'grow', style: 'min-width: 0;' },
        h('div', { class: 'fw-700' }, formatMoney(p.amountRub)),
        h('div', { class: 'text-xs text-muted mt-1' },
          formatDate(p.paidAt ?? p.createdAt)
        )
      ),
      statusBadge(p.status)
    ),
    h('div', { class: 'row-between mt-3 row-wrap gap-2' },
      h('span', { class: 'badge' },
        p.isRecurrent ? 'Автоплатёж' : 'Первый',
        p.isTest ? ' · тест' : ''
      ),
      p.receiptUrl
        ? h('a', {
            class: 'btn btn-ghost btn-sm',
            href: p.receiptUrl,
            target: '_blank',
            rel: 'noopener',
          },
            icon('file-text', { size: 14, className: 'icon icon-sm' }),
            'Чек'
          )
        : null
    )
  );
}