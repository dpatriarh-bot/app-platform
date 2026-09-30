// ============================================================
// components/form.ts — поля ввода, формы, валидация
// ============================================================

import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import type { ValidationResult } from '../lib/validation.js';

export interface FieldOptions {
  name: string;
  label: string;
  type?: 'text' | 'email' | 'password' | 'tel' | 'number' | 'date' | 'datetime-local';
  placeholder?: string;
  value?: string;
  required?: boolean;
  hint?: string;
  autocomplete?: string;
  inputMode?: 'text' | 'email' | 'tel' | 'numeric' | 'decimal' | 'search';
  maxLength?: number;
  min?: number | string;
  max?: number | string;
  pattern?: string;
  disabled?: boolean;
  validate?: (value: string) => ValidationResult;
  onInput?: (value: string, field: FieldHandle) => void;
  onChange?: (value: string, field: FieldHandle) => void;
}

export interface FieldHandle {
  root: HTMLElement;
  input: HTMLInputElement;
  getValue(): string;
  setValue(v: string): void;
  setError(msg: string | null): void;
  clearError(): void;
  validate(): boolean;
  name: string;
}

export function field(options: FieldOptions): FieldHandle {
  const input = h('input', {
    class: 'input',
    type: options.type ?? 'text',
    name: options.name,
    id: `field-${options.name}`,
    placeholder: options.placeholder ?? '',
    value: options.value ?? '',
    autocomplete: options.autocomplete ?? 'off',
    inputmode: options.inputMode,
    maxlength: options.maxLength,
    min: options.min,
    max: options.max,
    pattern: options.pattern,
    disabled: options.disabled,
  }) as HTMLInputElement;

  const errorEl = h('div', { class: 'field-error' });
  const hintEl = options.hint ? h('div', { class: 'field-hint' }, options.hint) : null;

  const root = h('div', { class: 'field' },
    h('label', { class: 'field-label', for: `field-${options.name}` },
      options.label,
      options.required ? h('span', { class: 'req' }, '*') : null
    ),
    input,
    errorEl,
    hintEl
  );

  const handle: FieldHandle = {
    root,
    input,
    name: options.name,
    getValue: () => input.value,
    setValue: (v: string) => { input.value = v; },
    setError(msg: string | null) {
      if (msg) {
        root.classList.add('has-error');
        errorEl.textContent = msg;
      } else {
        root.classList.remove('has-error');
        errorEl.textContent = '';
      }
    },
    clearError() {
      root.classList.remove('has-error');
      errorEl.textContent = '';
    },
    validate(): boolean {
      const value = input.value;
      if (options.required && value.trim() === '') {
        handle.setError('Поле обязательно для заполнения');
        return false;
      }
      if (options.validate) {
        const result = options.validate(value);
        if (!result.valid) {
          handle.setError(result.error ?? 'Некорректное значение');
          return false;
        }
      }
      handle.clearError();
      return true;
    },
  };

  input.addEventListener('input', () => {
    handle.clearError();
    options.onInput?.(input.value, handle);
  });
  input.addEventListener('change', () => {
    options.onChange?.(input.value, handle);
  });
  input.addEventListener('blur', () => {
    if (options.validate || options.required) {
      handle.validate();
    }
  });

  return handle;
}

// ============================================================
// PASSWORD FIELD (с глазиком)
// Корректно оборачивает существующий input, не перемещая его
// через insertBefore, что вызывало NotFoundError.
// ============================================================

export function passwordField(options: FieldOptions): FieldHandle {
  const base = field({ ...options, type: 'password' });

  // Обёртка вокруг input
  const wrap = h('div', { class: 'input-wrap' });

  // Кнопка-глазик
  const toggle = h('button', {
    type: 'button',
    class: 'input-toggle',
    tabindex: -1,
    'aria-label': 'Показать пароль',
    onclick: (e: Event) => {
      e.preventDefault();
      const isPassword = base.input.type === 'password';
      base.input.type = isPassword ? 'text' : 'password';
      toggle.replaceChildren(icon(isPassword ? 'eye-off' : 'eye', { size: 18 }));
    },
  }, icon('eye', { size: 18 }));

  // Заменяем input в DOM на wrap, а input кладём внутрь wrap.
  // Это безопасно: input ещё внутри base.root, а мы вставляем wrap
  // на его место через replaceChild.
  base.input.parentElement?.replaceChild(wrap, base.input);
  wrap.appendChild(base.input);
  wrap.appendChild(toggle);

  return base;
}

// ============================================================
// SELECT FIELD
// ============================================================

export interface SelectOptions {
  name: string;
  label: string;
  value?: string;
  required?: boolean;
  placeholder?: string;
  options: Array<{ value: string; label: string }>;
  onChange?: (value: string, handle: SelectHandle) => void;
}

export interface SelectHandle {
  root: HTMLElement;
  select: HTMLSelectElement;
  getValue(): string;
  setValue(v: string): void;
  setError(msg: string | null): void;
  validate(): boolean;
}

export function selectField(options: SelectOptions): SelectHandle {
  const select = h('select', {
    class: 'select',
    name: options.name,
    id: `field-${options.name}`,
  }) as HTMLSelectElement;

  if (options.placeholder) {
    select.appendChild(h('option', { value: '', disabled: true, selected: !options.value }, options.placeholder));
  }

  for (const opt of options.options) {
    select.appendChild(h('option', {
      value: opt.value,
      selected: opt.value === options.value,
    }, opt.label));
  }

  const errorEl = h('div', { class: 'field-error' });
  const root = h('div', { class: 'field' },
    h('label', { class: 'field-label', for: `field-${options.name}` },
      options.label,
      options.required ? h('span', { class: 'req' }, '*') : null
    ),
    select,
    errorEl
  );

  const handle: SelectHandle = {
    root,
    select,
    getValue: () => select.value,
    setValue: (v: string) => { select.value = v; },
    setError(msg: string | null) {
      if (msg) {
        root.classList.add('has-error');
        errorEl.textContent = msg;
      } else {
        root.classList.remove('has-error');
        errorEl.textContent = '';
      }
    },
    validate(): boolean {
      if (options.required && !select.value) {
        handle.setError('Выберите значение');
        return false;
      }
      handle.setError(null);
      return true;
    },
  };

  select.addEventListener('change', () => {
    handle.setError(null);
    options.onChange?.(select.value, handle);
  });

  return handle;
}

// ============================================================
// CHECKBOX FIELD
// ============================================================

export interface CheckboxOptions {
  name: string;
  label: string;
  checked?: boolean;
  required?: boolean;
  errorMessage?: string;
  onChange?: (checked: boolean) => void;
}

export interface CheckboxHandle {
  root: HTMLElement;
  input: HTMLInputElement;
  isChecked(): boolean;
  setChecked(v: boolean): void;
  setError(msg: string | null): void;
  validate(): boolean;
}

export function checkboxField(options: CheckboxOptions): CheckboxHandle {
  const input = h('input', {
    type: 'checkbox',
    name: options.name,
    id: `field-${options.name}`,
    checked: options.checked,
  }) as HTMLInputElement;

  const errorEl = h('div', { class: 'field-error' });

  const root = h('div', { class: 'field' },
    h('label', { class: 'check', for: `field-${options.name}` },
      input,
      h('span', { class: 'check-box' }),
      h('span', null, options.label)
    ),
    errorEl
  );

  const handle: CheckboxHandle = {
    root,
    input,
    isChecked: () => input.checked,
    setChecked: (v: boolean) => { input.checked = v; },
    setError(msg: string | null) {
      if (msg) {
        root.classList.add('has-error');
        errorEl.textContent = msg;
      } else {
        root.classList.remove('has-error');
        errorEl.textContent = '';
      }
    },
    validate(): boolean {
      if (options.required && !input.checked) {
        handle.setError(options.errorMessage ?? 'Необходимо согласие');
        return false;
      }
      handle.setError(null);
      return true;
    },
  };

  input.addEventListener('change', () => {
    handle.setError(null);
    options.onChange?.(input.checked);
  });

  return handle;
}

// ============================================================
// FORM WRAPPER
// ============================================================

export interface FormOptions {
  fields: HTMLElement[];
  submitLabel: string;
  onSubmit: () => void | Promise<void>;
  secondaryAction?: HTMLElement;
  loading?: boolean;
}

export interface FormHandle {
  root: HTMLFormElement;
  setLoading(v: boolean): void;
  setSubmitError(msg: string | null): void;
  setSubmitSuccess(msg: string | null): void;
  submitButton: HTMLButtonElement;
}

export function form(options: FormOptions): FormHandle {
  const submitBtn = h('button', {
    class: 'btn btn-lg btn-block',
    type: 'submit',
  }, options.submitLabel) as HTMLButtonElement;

  const alertBox = h('div', { class: 'hide' });

  const formEl = h('form', {
    class: 'stack',
    novalidate: 'true',
    onsubmit: async (e: Event) => {
      e.preventDefault();
      if (submitBtn.disabled) return;
      handle.setLoading(true);
      handle.setSubmitError(null);
      try {
        await options.onSubmit();
      } finally {
        handle.setLoading(false);
      }
    },
  },
    ...options.fields,
    alertBox,
    submitBtn,
    options.secondaryAction
      ? h('div', { class: 'text-center mt-3' }, options.secondaryAction)
      : null
  ) as HTMLFormElement;

  const handle: FormHandle = {
    root: formEl,
    submitButton: submitBtn,
    setLoading(v: boolean) {
      submitBtn.disabled = v;
      if (v) {
        submitBtn.textContent = 'Отправка...';
      } else {
        submitBtn.textContent = options.submitLabel;
      }
    },
    setSubmitError(msg: string | null) {
      if (!msg) {
        alertBox.classList.add('hide');
        alertBox.replaceChildren();
        return;
      }
      alertBox.classList.remove('hide');
      alertBox.replaceChildren(
        h('div', { class: 'alert alert-danger' },
          icon('alert-circle', { size: 18, className: 'icon icon-sm alert-icon' }),
          h('div', null, msg)
        )
      );
    },
    setSubmitSuccess(msg: string | null) {
      if (!msg) {
        alertBox.classList.add('hide');
        alertBox.replaceChildren();
        return;
      }
      alertBox.classList.remove('hide');
      alertBox.replaceChildren(
        h('div', { class: 'alert alert-success' },
          icon('check-circle', { size: 18, className: 'icon icon-sm alert-icon' }),
          h('div', null, msg)
        )
      );
    },
  };

  return handle;
}