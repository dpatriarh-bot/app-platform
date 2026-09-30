// ============================================================
// pages/public/home.ts — главная страница
// Hero с растровой иллюстрацией learning-world.png.
// ============================================================

import { h } from '../../lib/dom.js';
import { icon, type IconName } from '../../lib/icons.js';
import { publicLayout, setRoot } from '../../components/layout.js';

interface Feature {
  icon: IconName;
  title: string;
  text: string;
  accent: 'primary' | 'accent' | 'info' | 'lav';
}

const FEATURES: Feature[] = [
  {
    icon: 'book-open',
    title: 'Тесты с автопроверкой',
    text: 'Задания по школьным дисциплинам. Ребёнок отвечает, система сразу считает результат.',
    accent: 'primary',
  },
  {
    icon: 'award',
    title: 'Трудокоины за успехи',
    text: 'За правильные ответы начисляются трудокоины. Чем больше занимается — тем выше баланс.',
    accent: 'accent',
  },
  {
    icon: 'star',
    title: 'Достижения и статусы',
    text: 'От «Новичка» до «Легенды». Достижения дают дополнительные трудокоины.',
    accent: 'lav',
  },
  {
    icon: 'shield',
    title: 'Честная проверка',
    text: 'Антифрод и очные проверки отсекают списывание. Результат каждого заслужен.',
    accent: 'info',
  },
  {
    icon: 'gift',
    title: 'Подарки от партнёров',
    text: 'Трудокоины обмениваются на книги, скидки и мастер-классы от проверенных партнёров.',
    accent: 'accent',
  },
  {
    icon: 'heart',
    title: '80% на благотворительность',
    text: 'Большая часть выручки идёт в фонд «Улыбка детям». Учиться — и помогать другим.',
    accent: 'primary',
  },
];

interface Step {
  number: string;
  title: string;
  text: string;
}

const STEPS: Step[] = [
  {
    number: '1',
    title: 'Регистрация',
    text: 'Создайте аккаунт родителя и добавьте ребёнка. Это займёт минуту.',
  },
  {
    number: '2',
    title: 'Подписка',
    text: 'От 141 ₽ в месяц. Автопродление отключается в один клик.',
  },
  {
    number: '3',
    title: 'Тесты',
    text: 'Ребёнок выбирает дисциплину и проходит задания на время.',
  },
  {
    number: '4',
    title: 'Подарки',
    text: 'За правильные ответы — трудокоины, за трудокоины — подарки от партнёров.',
  },
];

export function renderPublicHome(): void {
  const content = h('div', null,
    renderHero(),
    renderCharityBanner(),
    renderFeatures(),
    renderSteps(),
    renderCta()
  );

  setRoot(publicLayout({ active: 'home', content }));
}

function renderHero(): HTMLElement {
  return h('section', { class: 'hero' },
    h('div', { class: 'hero-content' },
      h('div', { class: 'hero-text' },
        h('div', { class: 'hero-badge' },
          icon('star', { size: 13, className: 'icon icon-sm' }),
          'Для школьников 1–11 классов'
        ),
        h('h1', { class: 'hero-title' },
          h('span', { class: 'hero-title-line' }, 'Учиться интересно —'),
          h('span', { class: 'hero-title-line hero-title-line-accent' },
            h('span', { class: 'hero-title-accent' }, 'с «Улыбкой ребёнка»')
          )
        ),
        h('p', { class: 'hero-subtitle' },
          'Интерактивные тесты, трудокоины за успехи и подарки от партнёров. ' +
          '80% выручки — на благотворительность.'
        ),
        h('div', { class: 'hero-cta' },
          h('a', {
            class: 'btn btn-lg',
            href: '#/register',
          },
            icon('user-plus', { size: 18 }),
            'Начать заниматься'
          ),
          h('a', {
            class: 'btn btn-secondary btn-lg',
            href: '#/tariffs',
          }, 'Тарифы')
        ),
        h('div', { class: 'hero-meta' },
          h('span', null, 'Подписка от ', h('strong', null, '141 ₽ / месяц')),
          h('span', { class: 'hero-meta-dot' }),
          h('span', null, 'Старт без оплаты')
        )
      ),

      h('div', { class: 'hero-illustration' },
        h('div', { class: 'hero-image-wrap' },
          h('img', {
            class: 'hero-image',
            src: '/illustrations/learning-world.png',
            alt: 'Учиться интересно с «Улыбкой ребёнка»',
            width: '1536',
            height: '1024',
            loading: 'eager',
            decoding: 'async',
          })
        )
      )
    )
  );
}

function renderCharityBanner(): HTMLElement {
  return h('section', { class: 'section' },
    h('div', { class: 'container' },
      h('div', {
        class: 'anim-slide-up',
        style: `
          position: relative;
          padding: var(--sp-10) var(--sp-8);
          background: linear-gradient(135deg, #F2867D 0%, #E8C77A 100%);
          color: #FFFFFF;
          border-radius: var(--r-2xl);
          overflow: hidden;
          text-align: center;
        `,
      },
        h('div', {
          style: `
            position: absolute; top: -60px; right: -60px;
            width: 240px; height: 240px; border-radius: 50%;
            background: rgba(255,255,255,0.12); pointer-events: none;
          `,
        }),
        h('div', {
          style: `
            position: absolute; bottom: -80px; left: -40px;
            width: 200px; height: 200px; border-radius: 50%;
            background: rgba(255,255,255,0.08); pointer-events: none;
          `,
        }),

        h('div', {
          class: 'row center',
          style: 'gap: var(--sp-3); margin-bottom: var(--sp-4); position: relative;',
        },
          icon('heart', { size: 28 }),
          h('div', {
            style: 'font-size: 13px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; opacity: 0.9;',
          }, 'Мы делаем добро')
        ),

        h('div', {
          style: 'font-size: clamp(56px, 6vw, 96px); font-weight: 900; line-height: 1; letter-spacing: -0.04em; position: relative;',
        }, '80%'),

        h('h2', {
          style: 'font-size: clamp(22px, 2vw + 14px, 34px); font-weight: 800; margin-top: var(--sp-3); letter-spacing: -0.02em; position: relative;',
        }, 'выручки с подписок — на благотворительность'),

        h('p', {
          style: 'font-size: var(--fz-lg); max-width: 640px; margin: var(--sp-5) auto 0; opacity: 0.95; line-height: 1.5; position: relative;',
        },
          'Мы перечисляем 80% от каждой оплаты подписки в благотворительный фонд «Улыбка детям». ' +
          'Ваша подписка помогает не только вашему ребёнку, но и детям, которым нужна поддержка.'
        ),

        h('div', {
          class: 'row center',
          style: 'gap: var(--sp-3); margin-top: var(--sp-6); flex-wrap: wrap; position: relative;',
        },
          h('span', {
            class: 'badge',
            style: 'background: rgba(255,255,255,0.22); color: #FFFFFF; border: 0; padding: 8px 16px; font-size: 13px;',
          },
            icon('check-circle', { size: 14, className: 'icon icon-sm' }),
            'Партнёр — фонд «Улыбка детям»'
          ),
          h('span', {
            class: 'badge',
            style: 'background: rgba(255,255,255,0.22); color: #FFFFFF; border: 0; padding: 8px 16px; font-size: 13px;',
          },
            icon('file-text', { size: 14, className: 'icon icon-sm' }),
            'Отчёты публикуем каждый квартал'
          )
        )
      )
    )
  );
}

function renderFeatures(): HTMLElement {
  return h('section', { class: 'section section-alt' },
    h('div', { class: 'container' },
      h('div', { class: 'section-header' },
        h('div', { class: 'section-eyebrow' }, 'Возможности'),
        h('h2', { class: 'section-title' }, 'Всё для результата'),
        h('p', { class: 'section-subtitle' },
          'Понятный интерфейс, честная проверка и награды за достижения.'
        )
      ),
      h('div', { class: 'feature-grid' },
        ...FEATURES.map((f) => renderFeatureCard(f))
      )
    )
  );
}

function renderFeatureCard(f: Feature): HTMLElement {
  const iconClass = f.accent === 'primary'
    ? 'feature-icon'
    : `feature-icon feature-icon-${f.accent}`;

  return h('div', { class: 'feature-card' },
    h('div', { class: iconClass }, icon(f.icon, { size: 24 })),
    h('h3', { class: 'feature-title' }, f.title),
    h('p', { class: 'feature-text' }, f.text)
  );
}

function renderSteps(): HTMLElement {
  return h('section', { class: 'section' },
    h('div', { class: 'container' },
      h('div', { class: 'section-header' },
        h('div', { class: 'section-eyebrow' }, 'Как это работает'),
        h('h2', { class: 'section-title' }, 'Четыре шага'),
        h('p', { class: 'section-subtitle' },
          'От регистрации до первого подарка.'
        )
      ),
      h('div', { class: 'steps-grid' },
        ...STEPS.map((s) => renderStepCard(s))
      )
    )
  );
}

function renderStepCard(s: Step): HTMLElement {
  return h('div', { class: 'step-card' },
    h('div', { class: 'step-number' }, s.number),
    h('h3', { class: 'step-title' }, s.title),
    h('p', { class: 'step-text' }, s.text)
  );
}

function renderCta(): HTMLElement {
  return h('section', { class: 'section section-alt' },
    h('div', { class: 'container' },
      h('div', { class: 'cta-block' },
        h('h2', { class: 'cta-title' }, 'Готовы начать?'),
        h('p', { class: 'cta-subtitle' },
          'Зарегистрируйтесь и получите доступ к демонстрационным тестам сразу.'
        ),
        h('div', { class: 'cta-actions' },
          h('a', {
            class: 'btn btn-white btn-lg',
            href: '#/register',
          },
            icon('user-plus', { size: 18 }),
            'Создать аккаунт'
          ),
          h('a', {
            class: 'btn btn-ghost-white btn-lg',
            href: '#/about',
          }, 'О центре')
        )
      )
    )
  );
}