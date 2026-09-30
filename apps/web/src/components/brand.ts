// ============================================================
// components/brand.ts — логотип-брендмарк (inline SVG)
// Используется в header, drawer, footer, admin, partner.
// ============================================================

export interface BrandMarkOptions {
  size?: number;
  className?: string;
}

/**
 * Возвращает inline SVG-логотип.
 * viewBox 0 0 48 48, чтобы масштабировалось без потерь.
 */
export function brandMark(options: BrandMarkOptions = {}): SVGSVGElement {
  const size = options.size ?? 40;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', options.className ?? 'brand-mark');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('role', 'img');

  // Круг (лицо)
  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circle.setAttribute('cx', '24');
  circle.setAttribute('cy', '24');
  circle.setAttribute('r', '14');
  circle.setAttribute('fill', '#F8C94A');
  circle.setAttribute('stroke', '#FFF1B7');
  circle.setAttribute('stroke-width', '2');
  svg.appendChild(circle);

  // Улыбка и глаза
  const face = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  face.setAttribute('d', 'M17 26c2.8 4.6 11.2 4.6 14 0M19 20h.01M29 20h.01');
  face.setAttribute('stroke', '#102F4F');
  face.setAttribute('stroke-width', '2.5');
  face.setAttribute('stroke-linecap', 'round');
  svg.appendChild(face);

  // Лучи
  const rays = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  rays.setAttribute(
    'd',
    'M24 4v5M24 39v5M4 24h5M39 24h5M9.8 9.8l3.5 3.5M34.7 34.7l3.5 3.5M38.2 9.8l-3.5 3.5M13.3 34.7l-3.5 3.5'
  );
  rays.setAttribute('stroke', '#F8C94A');
  rays.setAttribute('stroke-width', '2');
  rays.setAttribute('stroke-linecap', 'round');
  svg.appendChild(rays);

  return svg;
}