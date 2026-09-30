// ============================================================
// toast.ts — всплывающие уведомления
// ============================================================

import { h } from './dom.js';
import { icon, type IconName } from './icons.js';

type ToastType = 'success' | 'danger' | 'warn' | 'info';

const ICONS: Record<ToastType, IconName> = {
  success: 'check-circle',
  danger: 'x-circle',
  warn: 'alert-triangle',
  info: 'info',
};

export interface ToastOptions {
  type?: ToastType;
  duration?: number;
  description?: string;
}

export function toast(message: string, options: ToastOptions = {}): void {
  const root = document.getElementById('toast-root');
  if (!root) return;

  const type = options.type ?? 'info';
  const duration = options.duration ?? 4000;

  const el = h('div', { class: `toast toast-${type}`, role: 'status' },
    icon(ICONS[type], { size: 18, className: 'icon icon-sm' }),
    h('div', { class: 'grow' },
      h('div', { class: 'fw-600' }, message),
      options.description ? h('div', { class: 'text-sm text-muted mt-1' }, options.description) : null
    )
  );

  root.appendChild(el);

  const remove = (): void => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(20px)';
    setTimeout(() => el.remove(), 200);
  };

  setTimeout(remove, duration);
  el.addEventListener('click', remove);
}

export const toastSuccess = (msg: string, opts: ToastOptions = {}) =>
  toast(msg, { ...opts, type: 'success' });
export const toastError = (msg: string, opts: ToastOptions = {}) =>
  toast(msg, { ...opts, type: 'danger' });
export const toastWarn = (msg: string, opts: ToastOptions = {}) =>
  toast(msg, { ...opts, type: 'warn' });
export const toastInfo = (msg: string, opts: ToastOptions = {}) =>
  toast(msg, { ...opts, type: 'info' });