// ============================================================
// pages/public/about.ts — о центре
// ============================================================

import { h } from '../../lib/dom.js';
import { icon, type IconName } from '../../lib/icons.js';
import { publicLayout, setRoot } from '../../components/layout.js';

interface ValueItem {
  icon: IconName;
  title: string;
  text: string;
  accent: 'primary' | 'accent' | 'info' | 'lav';
}

const VALUES: ValueItem[] = [
  {
    icon: 'target',
    title: 'Результат',
    text: 'Оцениваем по реальному прогрессу ребёнка, а не по числу проведённых занятий.',
    accent: 'primary',
  },
  {
    icon: 'shield',
    title: 'Честность',
    text: 'Антифрод, очные проверки и прозрачная система баллов. Результат каждого заслужен.',
    accent: 'info',
  },
  {
    icon: 'smile',
    title: 'Интерес',
    text: 'Игровая механика, награды и подарки превращают учёбу в увлекательное занятие.',
    accent: 'accent',
  },
  {
    icon: 'users',
    title: 'Партнёрство',
    text: 'Работаем с родителями, школами и партнёрами — вместе получается лучше.',
    accent: 'lav',
  },
];

interface StatItem {
  value: string;
  label: string;
}

const STATS: StatItem[] = [
  { value: '6', label: 'дисциплин' },
  { value: '1–11', label: 'классы' },
  { value: '100%', label: 'автопроверка' },
  { value: '190 ₽', label: 'в месяц' },
];

export function renderPublicAbout(): void {
  const content = h('div', null,
    h('section', { class: 'section' },
      h('div', { class: 'container' },
        h('div', { class: 'section-header' },
          h('div', { class: 'section-eyebrow' }, 'О центре'),
          h('h1', { class: 'section-title' }, 'Помогаем учиться с интересом'),
          h('p', { class: 'section-subtitle' },
            '«Улыбка ребёнка» — образовательный центр для школьников 1–11 классов.'
          )
        ),
        h('div', { class: 'content-narrow' },
          h('p', { class: 'content-lead' },
            'Мы создаём среду, в которой детям интересно учиться, а родителям понятно, что происходит.'
          ),
          h('p', null,
            'Платформа объединяет интерактивные тесты, систему мотивации и партнёрские программы. ' +
            'Мы не заменяем школу, но помогаем закрепить материал, найти пробелы и получить удовольствие от результата.'
          )
        )
      )
    ),

    h('section', { class: 'section section-alt' },
      h('div', { class: 'container' },
        h('div', { class: 'section-header' },
          h('h2', { class: 'section-title' }, 'Наши ценности'),
          h('p', { class: 'section-subtitle' },
            'Четыре принципа, на которых строится вся работа центра.'
          )
        ),
        h('div', { class: 'feature-grid' },
          ...VALUES.map((v) => renderValue(v))
        )
      )
    ),

    h('section', { class: 'section' },
      h('div', { class: 'container' },
        h('div', { class: 'section-header' },
          h('h2', { class: 'section-title' }, 'Цифры'),
          h('p', { class: 'section-subtitle' }, 'Ключевые показатели платформы.')
        ),
        h('div', { class: 'stat-grid' },
          ...STATS.map((s) => renderStat(s))
        )
      )
    ),

    h('section', { class: 'section' },
      h('div', { class: 'container' },
        h('div', { class: 'cta-block' },
          h('h2', { class: 'cta-title' }, 'Присоединяйтесь'),
          h('p', { class: 'cta-subtitle' },
            'Зарегистрируйтесь и начните учиться с удовольствием.'
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
              href: '#/tariffs',
            }, 'Тарифы')
          )
        )
      )
    )
  );

  setRoot(publicLayout({ active: 'about', content }));
}

function renderValue(v: ValueItem): HTMLElement {
  const iconClass = v.accent === 'primary'
    ? 'feature-icon'
    : `feature-icon feature-icon-${v.accent}`;

  return h('div', { class: 'feature-card' },
    h('div', { class: iconClass }, icon(v.icon, { size: 24 })),
    h('h3', { class: 'feature-title' }, v.title),
    h('p', { class: 'feature-text' }, v.text)
  );
}

function renderStat(s: StatItem): HTMLElement {
  return h('div', { class: 'stat-tile' },
    h('div', { class: 'stat-tile-value' }, s.value),
    h('div', { class: 'stat-tile-label' }, s.label)
  );
}