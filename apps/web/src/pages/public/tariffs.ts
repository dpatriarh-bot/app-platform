// ============================================================
// pages/public/tariffs.ts — тарифы
// 3 плана + баннер 80%.
// ============================================================

import { h } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { publicLayout, setRoot } from '../../components/layout.js';

interface Plan {
  code: string;
  name: string;
  priceRub: number;
  periodDays: number;
  perMonth: number;
  discount: number;
  badge?: string;
  featured?: boolean;
}

const PLANS: Plan[] = [
  {
    code: 'monthly',
    name: 'Месяц',
    priceRub: 190,
    periodDays: 30,
    perMonth: 190,
    discount: 0,
  },
  {
    code: 'quarterly',
    name: '3 месяца',
    priceRub: 490,
    periodDays: 90,
    perMonth: Math.round(490 / 3),
    discount: Math.round((1 - 490 / (190 * 3)) * 100),
    badge: 'Выгодно',
  },
  {
    code: 'yearly',
    name: 'Год',
    priceRub: 1690,
    periodDays: 365,
    perMonth: Math.round(1690 / 12),
    discount: Math.round((1 - 1690 / (190 * 12)) * 100),
    badge: 'Максимум выгоды',
    featured: true,
  },
];

const INCLUDED: string[] = [
  'Все тесты по 6 дисциплинам',
  'Автопроверка и разбор ошибок',
  'Накопление трудокоинов за ответы',
  'Обмен трудокоинов на подарки',
  'Достижения и статусы ребёнка',
  'Антифрод и очная проверка',
  'Уведомления о списании и результатах',
  'Отключение автопродления в один клик',
];

interface FaqItem {
  q: string;
  a: string;
}

const FAQ: FaqItem[] = [
  {
    q: 'Нужно ли платить сразу?',
    a: 'Нет. Зарегистрируйтесь и посмотрите демонстрационные тесты. Оплата подключается в личном кабинете.',
  },
  {
    q: 'Как работает автопродление?',
    a: 'За 3 дня до списания приходит уведомление. Отключить можно в один клик — доступ сохранится до конца оплаченного периода.',
  },
  {
    q: 'Куда идут деньги?',
    a: '80% от каждой оплаты подписки мы перечисляем в благотворительный фонд «Улыбка детям».',
  },
  {
    q: 'Сколько детей можно добавить?',
    a: 'В одном аккаунте — несколько детей. У каждого свой прогресс, статус и баланс трудокоинов.',
  },
  {
    q: 'Что с персональными данными?',
    a: 'Данные хранятся на территории РФ. Экспорт и удаление — в личном кабинете.',
  },
];

export function renderPublicTariffs(): void {
  const content = h('div', null,
    h('section', { class: 'section' },
      h('div', { class: 'container' },
        h('div', { class: 'section-header' },
          h('div', { class: 'section-eyebrow' }, 'Тарифы'),
          h('h1', { class: 'section-title' }, 'Три способа сэкономить'),
          h('p', { class: 'section-subtitle' },
            'Все возможности включены. Чем дольше период — тем ниже цена за месяц.'
          )
        ),

        h('div', { class: 'plans-grid' },
          ...PLANS.map((p) => renderPlanCard(p))
        ),

        h('div', {
          class: 'card card-pad-lg tariff-charity-banner',
          style: 'max-width: 720px; margin: var(--sp-8) auto 0; text-align: center; background: linear-gradient(135deg, #F2867D 0%, #E8C77A 100%); color: #FFFFFF; border: 0;',
        },
          icon('heart', { size: 40, className: 'icon icon-2xl' }),
          h('h3', { style: 'margin-top: var(--sp-3); font-size: var(--fz-2xl); font-weight: 800;' },
            '80% — на благотворительность'
          ),
          h('p', { style: 'margin-top: var(--sp-3); opacity: 0.95; max-width: 560px; margin-left: auto; margin-right: auto;' },
            'Мы перечисляем 80% от каждой оплаты подписки в благотворительный фонд «Улыбка детям». Ваша подписка помогает детям, которым нужна поддержка.'
          )
        )
      )
    ),

    h('section', { class: 'section section-alt' },
      h('div', { class: 'container' },
        h('div', { class: 'section-header' },
          h('h2', { class: 'section-title' }, 'Частые вопросы')
        ),
        h('div', { class: 'faq-list' },
          ...FAQ.map((item) => renderFaq(item))
        )
      )
    )
  );

  setRoot(publicLayout({ active: 'tariffs', content }));
}

function renderPlanCard(p: Plan): HTMLElement {
  const classNames = ['plan-card'];
  if (p.featured) classNames.push('is-featured');

  return h('div', { class: classNames.join(' ') },
    p.badge
      ? h('div', {
          class: `plan-badge ${p.featured ? 'is-featured' : ''}`,
        }, p.badge)
      : null,

    h('h3', { class: 'plan-name' }, p.name),

    h('div', { class: 'plan-price' },
      h('span', { class: 'plan-amount' }, String(p.priceRub)),
      h('span', { class: 'plan-currency' }, '₽')
    ),

    h('div', { class: 'plan-per-month' },
      h('span', null, `${p.perMonth} ₽ / месяц`),
      p.discount > 0
        ? h('span', { class: 'plan-discount' }, `−${p.discount}%`)
        : null
    ),

    h('div', { class: 'plan-period' },
      p.periodDays === 30 ? 'На 30 дней' :
      p.periodDays === 90 ? 'На 90 дней' :
      'На 365 дней'
    ),

    h('hr', { class: 'divider' }),

    h('ul', { class: 'tariff-list' },
      ...INCLUDED.map((item) =>
        h('li', { class: 'tariff-list-item' },
          icon('check-circle', { size: 18, className: 'icon icon-sm' }),
          h('span', null, item)
        )
      )
    ),

    h('a', {
      class: `btn btn-block ${p.featured ? '' : 'btn-secondary'}`,
      href: '#/register',
    }, p.featured ? 'Выбрать годовой' : 'Выбрать')
  );
}

function renderFaq(item: FaqItem): HTMLElement {
  const details = h('details', { class: 'faq-item' });
  const summary = h('summary', null, item.q);
  details.appendChild(summary);
  details.appendChild(h('div', { class: 'faq-answer' }, item.a));
  return details;
}