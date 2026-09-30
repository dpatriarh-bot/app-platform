// ============================================================
// formula.ts — безопасный парсер математических выражений
// Не использует eval / Function / mathjs.evaluate.
// Поддерживает: +, -, *, /, ^, %, скобки, числа, унарный минус.
// Разрешённые функции: sqrt, abs, min, max, pow, round, floor, ceil.
// Разрешённые константы: pi, e.
// ============================================================

import { AppError } from './errors.js';

type Token =
  | { type: 'num'; value: number }
  | { type: 'op'; value: string }
  | { type: 'lparen' }
  | { type: 'rparen' }
  | { type: 'comma' }
  | { type: 'ident'; value: string };

const ALLOWED_FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sqrt: (x) => Math.sqrt(x),
  abs: (x) => Math.abs(x),
  min: (...args) => Math.min(...args),
  max: (...args) => Math.max(...args),
  pow: (x, y) => Math.pow(x, y),
  round: (x) => Math.round(x),
  floor: (x) => Math.floor(x),
  ceil: (x) => Math.ceil(x),
};

const ALLOWED_CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
};

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i]!;

    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    if (/\d/.test(ch) || (ch === '.' && /\d/.test(input[i + 1] ?? ''))) {
      let start = i;
      let hasDot = false;
      while (i < input.length) {
        const c = input[i]!;
        if (/\d/.test(c)) {
          i += 1;
        } else if (c === '.' && !hasDot) {
          hasDot = true;
          i += 1;
        } else if (c === 'e' || c === 'E') {
          if (i + 1 < input.length && /[+\-\d]/.test(input[i + 1]!)) {
            i += 2;
            while (i < input.length && /\d/.test(input[i]!)) i += 1;
          }
          break;
        } else {
          break;
        }
      }
      const numStr = input.slice(start, i);
      const value = Number(numStr);
      if (!Number.isFinite(value)) {
        throw new AppError('INVALID_FORMULA', `Некорректное число: ${numStr}`, 400);
      }
      tokens.push({ type: 'num', value });
      continue;
    }

    if (/[a-zA-Z_]/.test(ch)) {
      let start = i;
      while (i < input.length && /[a-zA-Z0-9_]/.test(input[i]!)) i += 1;
      tokens.push({ type: 'ident', value: input.slice(start, i).toLowerCase() });
      continue;
    }

    if ('+-*/^%'.includes(ch)) {
      tokens.push({ type: 'op', value: ch });
      i += 1;
      continue;
    }

    if (ch === '(') {
      tokens.push({ type: 'lparen' });
      i += 1;
      continue;
    }

    if (ch === ')') {
      tokens.push({ type: 'rparen' });
      i += 1;
      continue;
    }

    if (ch === ',') {
      tokens.push({ type: 'comma' });
      i += 1;
      continue;
    }

    throw new AppError('INVALID_FORMULA', `Недопустимый символ: ${ch}`, 400);
  }

  return tokens;
}

class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): number {
    const value = this.parseExpression();
    if (this.pos < this.tokens.length) {
      throw new AppError('INVALID_FORMULA', 'Лишние символы в конце выражения', 400);
    }
    return value;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private consume(): Token {
    const t = this.tokens[this.pos];
    if (!t) {
      throw new AppError('INVALID_FORMULA', 'Неожиданный конец выражения', 400);
    }
    this.pos += 1;
    return t;
  }

  private parseExpression(): number {
    let left = this.parseTerm();
    while (true) {
      const t = this.peek();
      if (t && t.type === 'op' && (t.value === '+' || t.value === '-')) {
        this.consume();
        const right = this.parseTerm();
        left = t.value === '+' ? left + right : left - right;
      } else {
        break;
      }
    }
    return left;
  }

  private parseTerm(): number {
    let left = this.parseUnary();
    while (true) {
      const t = this.peek();
      if (t && t.type === 'op' && (t.value === '*' || t.value === '/' || t.value === '%')) {
        this.consume();
        const right = this.parseUnary();
        if (t.value === '*') left = left * right;
        else if (t.value === '/') {
          if (right === 0) throw new AppError('INVALID_FORMULA', 'Деление на ноль', 400);
          left = left / right;
        } else {
          if (right === 0) throw new AppError('INVALID_FORMULA', 'Деление на ноль', 400);
          left = left % right;
        }
      } else {
        break;
      }
    }
    return left;
  }

  private parseUnary(): number {
    const t = this.peek();
    if (t && t.type === 'op' && (t.value === '-' || t.value === '+')) {
      this.consume();
      const value = this.parseUnary();
      return t.value === '-' ? -value : value;
    }
    return this.parsePower();
  }

  private parsePower(): number {
    const base = this.parseAtom();
    const t = this.peek();
    if (t && t.type === 'op' && t.value === '^') {
      this.consume();
      const exp = this.parseUnary();
      return Math.pow(base, exp);
    }
    return base;
  }

  private parseAtom(): number {
    const t = this.consume();

    if (t.type === 'num') return t.value;

    if (t.type === 'lparen') {
      const value = this.parseExpression();
      const rp = this.consume();
      if (rp.type !== 'rparen') {
        throw new AppError('INVALID_FORMULA', 'Ожидалась закрывающая скобка', 400);
      }
      return value;
    }

    if (t.type === 'ident') {
      const name = t.value;

      if (name in ALLOWED_CONSTANTS) {
        return ALLOWED_CONSTANTS[name]!;
      }

      const fn = ALLOWED_FUNCTIONS[name];
      if (!fn) {
        throw new AppError('INVALID_FORMULA', `Неизвестная функция: ${name}`, 400);
      }

      const lp = this.consume();
      if (lp.type !== 'lparen') {
        throw new AppError('INVALID_FORMULA', `Ожидалась скобка после ${name}`, 400);
      }

      const args: number[] = [];
      if (this.peek()?.type !== 'rparen') {
        args.push(this.parseExpression());
        while (this.peek()?.type === 'comma') {
          this.consume();
          args.push(this.parseExpression());
        }
      }

      const rp = this.consume();
      if (rp.type !== 'rparen') {
        throw new AppError('INVALID_FORMULA', 'Ожидалась закрывающая скобка', 400);
      }

      const result = fn(...args);
      if (!Number.isFinite(result)) {
        throw new AppError('INVALID_FORMULA', 'Результат не число', 400);
      }
      return result;
    }

    throw new AppError('INVALID_FORMULA', 'Неожиданный токен', 400);
  }
}

export function evaluateFormula(input: string): number {
  if (!input || typeof input !== 'string') {
    throw new AppError('INVALID_FORMULA', 'Пустое выражение', 400);
  }
  if (input.length > 500) {
    throw new AppError('INVALID_FORMULA', 'Выражение слишком длинное', 400);
  }

  const tokens = tokenize(input);
  if (tokens.length === 0) {
    throw new AppError('INVALID_FORMULA', 'Пустое выражение', 400);
  }

  const parser = new Parser(tokens);
  const result = parser.parse();

  if (!Number.isFinite(result)) {
    throw new AppError('INVALID_FORMULA', 'Результат не число', 400);
  }

  return result;
}

export function tryEvaluateFormula(input: string): number | null {
  try {
    return evaluateFormula(input);
  } catch {
    return null;
  }
}