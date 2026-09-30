// ============================================================
// phone.ts — нормализация российских телефонов в E.164
// Принимает +7..., 8..., 7..., с пробелами и скобками.
// Возвращает +7XXXXXXXXXX или null.
// ============================================================

const RU_PHONE_REGEX = /^(\+7|8|7)?[\s\-()]*(\d{3})[\s\-()]*(\d{3})[\s\-()]*(\d{2})[\s\-()]*(\d{2})$/;

export function normalizePhone(input: string): string | null {
  if (!input) return null;
  const cleaned = input.replace(/[^\d+]/g, '');
  const match = cleaned.match(RU_PHONE_REGEX);
  if (!match) return null;
  const [, , area, prefix, p1, p2] = match;
  return `+7${area}${prefix}${p1}${p2}`;
}

export function isValidRuPhone(input: string): boolean {
  return normalizePhone(input) !== null;
}

export function formatPhone(phone: string): string {
  if (!/^\+7\d{10}$/.test(phone)) return phone;
  const d = phone.slice(2);
  return `+7 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 8)}-${d.slice(8, 10)}`;
}