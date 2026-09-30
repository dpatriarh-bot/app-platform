// ============================================================
// pages/not-found.ts — 404 с иллюстрацией
// ============================================================

import { h } from '../lib/dom.js';
import { router } from '../lib/router.js';
import { illustration } from '../components/ui.js';

export function renderNotFound(): void {
  const root = document.getElementById('app');
  if (!root) return;

  root.replaceChildren(
    h('div', {
      class: 'center',
      style: 'min-height: 100vh; padding: 24px; background: var(--c-bg);',
    },
      h('div', { class: 'text-center anim-slide-up', style: 'max-width: 480px;' },
        illustration('not-found', 240),
        h('h1', {
          style: 'font-size: var(--fz-5xl); font-weight: var(--fw-black); letter-spacing: var(--ls-tight); margin-top: var(--sp-6);',
        }, '404'),
        h('p', { class: 'text-muted mt-3' },
          'Страница не найдена или была перемещена.'
        ),
        h('div', { class: 'row gap-3 center mt-8', style: 'flex-wrap: wrap;' },
          h('button', {
            class: 'btn btn-lg',
            type: 'button',
            onclick: () => router.navigate('/'),
          }, 'На главную'),
          h('button', {
            class: 'btn btn-secondary btn-lg',
            type: 'button',
            onclick: () => history.back(),
          }, 'Назад')
        )
      )
    )
  );
}