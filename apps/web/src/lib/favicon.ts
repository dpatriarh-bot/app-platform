// ============================================================
// lib/favicon.ts — анимированный favicon «Солнышко»
// Перерисовывает <link rel="icon"> через Canvas.
// Улыбка «дышит», лучи вращаются и отдаляются/притягиваются.
// ============================================================

const CANVAS_SIZE = 64;
const FRAME_INTERVAL = 1000 / 30; // 30 fps — баланс плавности и CPU

interface FaviconElements {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  link: HTMLLinkElement;
  rafId: number;
  lastFrame: number;
  running: boolean;
}

let state: FaviconElements | null = null;

/**
 * Запускает анимированный favicon.
 * Идемпотентно: повторный вызов ничего не делает.
 */
export function startAnimatedFavicon(): void {
  if (state) return;
  if (typeof document === 'undefined') return;

  // Уважаем prefers-reduced-motion: не анимируем
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReduced) {
    setStaticFavicon();
    return;
  }

  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Находим или создаём <link rel="icon">
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  // Убираем type="image/svg+xml", потому что будем отдавать PNG из canvas
  link.removeAttribute('type');
  link.removeAttribute('href');

  state = {
    canvas,
    ctx,
    link,
    rafId: 0,
    lastFrame: 0,
    running: true,
  };

  // Останавливаем анимацию при уходе со страницы — экономим CPU
  document.addEventListener('visibilitychange', onVisibilityChange);

  state.rafId = requestAnimationFrame(tick);
}

/**
 * Останавливает анимацию и возвращает статичный SVG.
 */
export function stopAnimatedFavicon(): void {
  if (!state) return;

  state.running = false;
  cancelAnimationFrame(state.rafId);
  document.removeEventListener('visibilitychange', onVisibilityChange);

  state = null;
  setStaticFavicon();
}

function onVisibilityChange(): void {
  if (!state) return;

  if (document.hidden) {
    // Вкладка скрыта — пауза
    cancelAnimationFrame(state.rafId);
    state.running = false;
  } else if (!state.running) {
    // Вернулись — продолжаем
    state.running = true;
    state.lastFrame = performance.now();
    state.rafId = requestAnimationFrame(tick);
  }
}

function tick(now: number): void {
  if (!state || !state.running) return;

  // Ограничиваем частоту до 30 fps
  if (now - state.lastFrame < FRAME_INTERVAL) {
    state.rafId = requestAnimationFrame(tick);
    return;
  }
  state.lastFrame = now;

  drawFrame(state.ctx, now);

  try {
    state.link.href = state.canvas.toDataURL('image/png');
  } catch {
    // Если canvas затайнтился (не должно), просто прекращаем
    stopAnimatedFavicon();
    return;
  }

  state.rafId = requestAnimationFrame(tick);
}

// ============================================================
// Отрисовка кадра
// ============================================================

function drawFrame(ctx: CanvasRenderingContext2D, now: number): void {
  const size = CANVAS_SIZE;
  const cx = size / 2;
  const cy = size / 2;

  ctx.clearRect(0, 0, size, size);

  // Время в секундах и фазы
  const t = now / 1000;
  const breathPhase = Math.sin(t * 1.6); // период ~4 сек, плавное «дыхание»
  const rotationPhase = t * 0.5;         // медленное вращение лучей
  const rayDistancePhase = Math.sin(t * 1.2) * 0.5 + 0.5; // лучи отдаляются/притягиваются

  // Базовые радиусы (пропорционально размеру canvas)
  const faceRadiusBase = size * 0.30;    // ~19.2 при 64
  const faceRadius = faceRadiusBase * (1 + 0.06 * breathPhase); // ±6%
  const rayInner = faceRadiusBase + size * 0.06; // ~3.8
  const rayOuterBase = size * 0.46;      // ~29.4
  const rayOuter = rayInner + (rayOuterBase - rayInner) * (0.7 + 0.3 * rayDistancePhase);

  // ----------------------------------------------------------
  // Лучи (рисуем ДО лица, чтобы они уходили под круг)
  // ----------------------------------------------------------

  const rayCount = 8;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotationPhase);

  ctx.strokeStyle = '#F8C94A';
  ctx.lineWidth = Math.max(1.5, size * 0.04); // ~2.5 при 64
  ctx.lineCap = 'round';

  for (let i = 0; i < rayCount; i++) {
    const angle = (i / rayCount) * Math.PI * 2;
    const x1 = Math.cos(angle) * rayInner;
    const y1 = Math.sin(angle) * rayInner;
    const x2 = Math.cos(angle) * rayOuter;
    const y2 = Math.sin(angle) * rayOuter;

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  ctx.restore();

  // ----------------------------------------------------------
  // Лицо (жёлтый круг с лёгкой обводкой)
  // ----------------------------------------------------------

  const gradient = ctx.createRadialGradient(
    cx - faceRadius * 0.3,
    cy - faceRadius * 0.3,
    faceRadius * 0.2,
    cx,
    cy,
    faceRadius
  );
  gradient.addColorStop(0, '#FFD97A');
  gradient.addColorStop(1, '#F8C94A');

  ctx.beginPath();
  ctx.arc(cx, cy, faceRadius, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.lineWidth = Math.max(1, size * 0.03);
  ctx.strokeStyle = '#FFF1B7';
  ctx.stroke();

  // ----------------------------------------------------------
  // Улыбка и глаза
  // ----------------------------------------------------------

  const faceStroke = '#102F4F';
  const strokeWidth = Math.max(1.5, size * 0.045); // ~2.9 при 64

  ctx.strokeStyle = faceStroke;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = 'round';

  // Улыбка — дуга. Радиус чуть меняется вместе с «дыханием», чтобы улыбка выглядела живой
  const smileRadius = faceRadius * 0.55;
  const smileStart = Math.PI * 0.2;
  const smileEnd = Math.PI * 0.8;

  ctx.beginPath();
  ctx.arc(cx, cy - faceRadius * 0.05, smileRadius, smileStart, smileEnd);
  ctx.stroke();

  // Глаза — короткие вертикальные штрихи
  const eyeOffsetX = faceRadius * 0.38;
  const eyeOffsetY = faceRadius * 0.28;
  const eyeLen = faceRadius * 0.18;

  ctx.beginPath();
  ctx.moveTo(cx - eyeOffsetX, cy - eyeOffsetY - eyeLen / 2);
  ctx.lineTo(cx - eyeOffsetX, cy - eyeOffsetY + eyeLen / 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx + eyeOffsetX, cy - eyeOffsetY - eyeLen / 2);
  ctx.lineTo(cx + eyeOffsetX, cy - eyeOffsetY + eyeLen / 2);
  ctx.stroke();
}

// ============================================================
// Статичный SVG — fallback и prefers-reduced-motion
// ============================================================

function setStaticFavicon(): void {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.type = 'image/svg+xml';
  link.href = '/logo.svg';
}