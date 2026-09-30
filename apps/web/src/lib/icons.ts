// ============================================================
// icons.ts — работа с SVG-спрайтом Feather
// icon(name, size?) возвращает HTMLElement <svg><use href=.../></svg>
// ============================================================

const SPRITE_URL = '/icons/feather-sprite.svg';

export type IconName =
  | 'home' | 'user' | 'users' | 'lock' | 'unlock'
  | 'log-in' | 'log-out' | 'settings' | 'bell'
  | 'check' | 'check-circle' | 'x' | 'x-circle'
  | 'alert-circle' | 'alert-triangle' | 'info' | 'help-circle'
  | 'plus' | 'minus' | 'edit' | 'edit-2' | 'trash' | 'trash-2' | 'save'
  | 'download' | 'upload' | 'search' | 'filter' | 'menu'
  | 'more-vertical' | 'more-horizontal'
  | 'chevron-down' | 'chevron-up' | 'chevron-left' | 'chevron-right'
  | 'arrow-left' | 'arrow-right' | 'arrow-up' | 'arrow-down'
  | 'refresh-cw' | 'star' | 'award' | 'gift'
  | 'credit-card' | 'dollar-sign'
  | 'book-open' | 'hash' | 'leaf' | 'zap' | 'clock' | 'globe'
  | 'pie-chart' | 'bar-chart-2' | 'trending-up' | 'activity'
  | 'eye' | 'eye-off' | 'shield' | 'shield-off'
  | 'send' | 'mail' | 'phone' | 'calendar' | 'file-text' | 'image'
  | 'external-link' | 'link' | 'copy'
  | 'check-square' | 'square' | 'circle' | 'loader'
  | 'key' | 'grid' | 'list' | 'sliders' | 'flag' | 'target'
  | 'smile' | 'frown' | 'sun' | 'moon' | 'book';

export interface IconOptions {
  size?: number;
  className?: string;
  strokeWidth?: number;
}

export function icon(name: IconName, options: IconOptions = {}): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const size = options.size ?? 20;

  svg.setAttribute('class', options.className ?? 'icon');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', String(options.strokeWidth ?? 2));
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');

  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `${SPRITE_URL}#${name}`);
  svg.appendChild(use);

  return svg;
}

export function iconElement(name: IconName, options: IconOptions = {}): SVGSVGElement {
  return icon(name, options);
}