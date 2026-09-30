// ============================================================
// validation.ts — клиентская валидация форм
// Согласована с серверными Zod-схемами.
// ============================================================

export const PASSWORD_MIN = 8;

const PHONE_RE = /^(\+7|8|7)?[\s\-()]*\d{3}[\s\-()]*\d{3}[\s\-()]*\d{2}[\s\-()]*\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validatePhone(input: string): ValidationResult {
  if (!input.trim()) return { valid: false, error: 'Укажите телефон' };
  if (!PHONE_RE.test(input)) return { valid: false, error: 'Некорректный формат телефона' };
  return { valid: true };
}

export function validateEmail(input: string): ValidationResult {
  if (!input.trim()) return { valid: false, error: 'Укажите почту' };
  if (!EMAIL_RE.test(input)) return { valid: false, error: 'Некорректный формат почты' };
  return { valid: true };
}

export function validatePassword(input: string): ValidationResult {
  if (!input) return { valid: false, error: 'Введите пароль' };
  if (input.length < PASSWORD_MIN) {
    return { valid: false, error: `Минимум ${PASSWORD_MIN} символов` };
  }
  if (!/[A-Za-z]/.test(input)) return { valid: false, error: 'Должна быть латинская буква' };
  if (!/\d/.test(input)) return { valid: false, error: 'Должна быть цифра' };
  return { valid: true };
}

export function validatePasswordConfirm(password: string, confirm: string): ValidationResult {
  if (!confirm) return { valid: false, error: 'Повторите пароль' };
  if (password !== confirm) return { valid: false, error: 'Пароли не совпадают' };
  return { valid: true };
}

export function validateFullName(input: string): ValidationResult {
  const trimmed = input.trim();
  if (!trimmed) return { valid: false, error: 'Укажите ФИО' };
  if (trimmed.length < 2) return { valid: false, error: 'Слишком короткое ФИО' };
  if (trimmed.length > 200) return { valid: false, error: 'Слишком длинное ФИО' };
  return { valid: true };
}

export function validateBirthDate(input: string): ValidationResult {
  if (!input) return { valid: false, error: 'Укажите дату рождения' };
  if (!DATE_RE.test(input)) return { valid: false, error: 'Формат ГГГГ-ММ-ДД' };
  const d = new Date(input);
  if (isNaN(d.getTime())) return { valid: false, error: 'Некорректная дата' };
  if (d >= new Date()) return { valid: false, error: 'Дата должна быть в прошлом' };
  const age = new Date().getFullYear() - d.getFullYear();
  if (age > 25) return { valid: false, error: 'Слишком большой возраст' };
  return { valid: true };
}

export function validateGrade(input: number | string): ValidationResult {
  const n = typeof input === 'string' ? parseInt(input, 10) : input;
  if (isNaN(n)) return { valid: false, error: 'Выберите класс' };
  if (n < 1 || n > 11) return { valid: false, error: 'Класс от 1 до 11' };
  return { valid: true };
}

export function validateRequired(input: string, label = 'Поле'): ValidationResult {
  if (!input.trim()) return { valid: false, error: `${label} обязательно` };
  return { valid: true };
}

export function validateMinLength(input: string, min: number, label = 'Поле'): ValidationResult {
  if (input.trim().length < min) {
    return { valid: false, error: `${label} минимум ${min} символов` };
  }
  return { valid: true };
}

export function validateMaxLength(input: string, max: number, label = 'Поле'): ValidationResult {
  if (input.length > max) {
    return { valid: false, error: `${label} максимум ${max} символов` };
  }
  return { valid: true };
}

export function validateNumberInRange(
  input: number | string,
  min: number,
  max: number,
  label = 'Значение'
): ValidationResult {
  const n = typeof input === 'string' ? Number(input.replace(',', '.')) : input;
  if (!Number.isFinite(n)) return { valid: false, error: `${label}: не число` };
  if (n < min) return { valid: false, error: `${label}: минимум ${min}` };
  if (n > max) return { valid: false, error: `${label}: максимум ${max}` };
  return { valid: true };
}