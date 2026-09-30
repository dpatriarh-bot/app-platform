// ============================================================
// components/captcha.ts — виджет hCaptcha (или stub)
// ============================================================

import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';

interface CaptchaConfig {
  provider: 'stub' | 'hcaptcha' | 'pow';
  siteKey: string;
}

let cachedConfig: CaptchaConfig | null = null;
let scriptLoaded = false;
let scriptLoading: Promise<void> | null = null;

const HCAPTCHA_SCRIPT = 'https://js.hcaptcha.com/1/api.js?render=explicit&recaptchacompat=off';

declare global {
  interface Window {
    hcaptcha?: {
      render: (
        container: HTMLElement,
        opts: {
          sitekey: string;
          callback: (token: string) => void;
          'expired-callback'?: () => void;
          'error-callback'?: () => void;
          theme?: 'light' | 'dark';
          size?: 'normal' | 'compact';
        }
      ) => string;
      reset: (widgetId?: string) => void;
    };
  }
}

async function loadConfig(): Promise<CaptchaConfig> {
  if (cachedConfig) return cachedConfig;
  try {
    const res = await fetch('/api/v1/captcha/config');
    if (res.ok) {
      cachedConfig = (await res.json()) as CaptchaConfig;
    } else {
      cachedConfig = { provider: 'stub', siteKey: '' };
    }
  } catch {
    cachedConfig = { provider: 'stub', siteKey: '' };
  }
  return cachedConfig;
}

function loadScript(): Promise<void> {
  if (scriptLoaded && window.hcaptcha) return Promise.resolve();
  if (scriptLoading) return scriptLoading;

  scriptLoading = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${HCAPTCHA_SCRIPT}"]`);
    if (existing) {
      existing.addEventListener('load', () => {
        scriptLoaded = true;
        resolve();
      });
      existing.addEventListener('error', () => reject(new Error('script error')));
      return;
    }

    const s = document.createElement('script');
    s.src = HCAPTCHA_SCRIPT;
    s.async = true;
    s.defer = true;
    s.onload = () => {
      scriptLoaded = true;
      resolve();
    };
    s.onerror = () => reject(new Error('script error'));
    document.head.appendChild(s);
  });

  return scriptLoading;
}

export interface CaptchaHandle {
  root: HTMLElement;
  getToken(): string | null;
  reset(): void;
}

export async function captchaField(): Promise<CaptchaHandle> {
  const config = await loadConfig();

  const tokenBox: { value: string | null } = { value: null };

  if (config.provider === 'stub') {
    // Заглушка: сразу считаем пройденной
    tokenBox.value = 'stub-token';

    const root = h('div', {
      class: 'captcha-stub',
      style: 'padding: 12px; background: var(--c-surface-3); border-radius: var(--r-sm); font-size: var(--fz-sm); color: var(--c-text-muted); display: flex; align-items: center; gap: 8px;',
    },
      icon('check-circle', { size: 16, className: 'icon icon-sm' }),
      'Проверка безопасности не требуется'
    );

    return {
      root,
      getToken: () => tokenBox.value,
      reset: () => { tokenBox.value = 'stub-token'; },
    };
  }

  if (config.provider === 'hcaptcha') {
    const container = h('div', {
      class: 'captcha-widget',
      style: 'min-height: 78px; display: flex; justify-content: center;',
    });

    const root = h('div', { class: 'field' },
      h('label', { class: 'field-label' }, 'Проверка безопасности'),
      container
    );

    try {
      await loadScript();
      if (window.hcaptcha) {
        window.hcaptcha.render(container, {
          sitekey: config.siteKey,
          callback: (token: string) => { tokenBox.value = token; },
          'expired-callback': () => { tokenBox.value = null; },
          'error-callback': () => { tokenBox.value = null; },
          theme: 'light',
        });
      } else {
        container.textContent = 'Не удалось загрузить капчу';
      }
    } catch {
      container.textContent = 'Не удалось загрузить капчу';
    }

    return {
      root,
      getToken: () => tokenBox.value,
      reset: () => {
        tokenBox.value = null;
        try { window.hcaptcha?.reset(); } catch { /* ignore */ }
      },
    };
  }

  // provider === 'pow' — заглушка, challenge через /auth/captcha/challenge
  tokenBox.value = 'pow-stub';

  const root = h('div', {
    style: 'padding: 12px; background: var(--c-surface-3); border-radius: var(--r-sm); font-size: var(--fz-sm); color: var(--c-text-muted);',
  }, 'Proof-of-work капча (не требуется)');

  return {
    root,
    getToken: () => tokenBox.value,
    reset: () => { tokenBox.value = 'pow-stub'; },
  };
}