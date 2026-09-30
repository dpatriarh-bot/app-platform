// ============================================================
// pages/public/contacts.ts — контакты
// ============================================================

import { h } from '../../lib/dom.js';
import { icon, type IconName } from '../../lib/icons.js';
import { publicLayout, setRoot } from '../../components/layout.js';

interface ContactItem {
  icon: IconName;
  label: string;
  value: string;
  href: string | null;
  hint: string;
}

const CONTACTS: ContactItem[] = [
  {
    icon: 'phone',
    label: 'Телефон',
    value: '+7 (495) 000-00-00',
    href: 'tel:+74950000000',
    hint: 'Пн–Пт, 9:00–19:00',
  },
  {
    icon: 'mail',
    label: 'Email',
    value: 'info@ulybka.ru',
    href: 'mailto:info@ulybka.ru',
    hint: 'Ответим в течение дня',
  },
  {
    icon: 'clock',
    label: 'Часы работы',
    value: 'Пн–Пт, 9:00–19:00',
    href: null,
    hint: 'Сб–Вс — выходные',
  },
];

export function renderPublicContacts(): void {
  const content = h('div', null,
    h('section', { class: 'section' },
      h('div', { class: 'container' },
        h('div', { class: 'section-header' },
          h('div', { class: 'section-eyebrow' }, 'Контакты'),
          h('h1', { class: 'section-title' }, 'Свяжитесь с нами'),
          h('p', { class: 'section-subtitle' },
            'Отвечаем на вопросы родителей и партнёров в рабочие часы.'
          )
        ),
        h('div', { class: 'contact-grid' },
          ...CONTACTS.map((c) => renderContact(c))
        )
      )
    ),

    h('section', { class: 'section' },
      h('div', { class: 'container' },
        h('div', { class: 'cta-block' },
          h('h2', { class: 'cta-title' }, 'Готовы задать вопрос?'),
          h('p', { class: 'cta-subtitle' },
            'Зарегистрируйтесь и напишите нам прямо в личном кабинете.'
          ),
          h('div', { class: 'cta-actions' },
            h('a', {
              class: 'btn btn-white btn-lg',
              href: '#/register',
            }, 'Создать аккаунт'),
            h('a', {
              class: 'btn btn-ghost-white btn-lg',
              href: '#/about',
            }, 'О центре')
          )
        )
      )
    )
  );

  setRoot(publicLayout({ active: 'contacts', content }));
}

function renderContact(c: ContactItem): HTMLElement {
  return h('div', { class: 'contact-card' },
    h('div', { class: 'contact-icon' }, icon(c.icon, { size: 22 })),
    h('div', { class: 'contact-label' }, c.label),
    h('div', { class: 'contact-value' },
      c.href
        ? h('a', { href: c.href }, c.value)
        : c.value
    ),
    h('div', { class: 'text-xs text-muted mt-2' }, c.hint)
  );
}