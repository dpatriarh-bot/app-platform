// ============================================================
// questions/checker.ts — проверка ответов всех 7 типов
// Без mathjs.evaluate — собственный безопасный парсер формул.
// Возвращает: isCorrect, partialScore, normalizedUserAnswer.
// ============================================================

import type { Question } from '../../db/schema.js';

export interface CheckResult {
  isCorrect: boolean;
  partialScore: number;
  normalizedUserAnswer: unknown;
}

const EPSILON_DEFAULT = 1e-6;

// ============================================================
// БЕЗОПАСНЫЙ ПАРСЕР ФОРМУЛ
// Без eval / mathjs. Только числа, операторы +-*/(), ^,
// и функции из белого списка. Никаких символов, вызовов,
// импортов, присваиваний.
// ============================================================

type Token =
  | { kind: 'num'; value: number }
  | { kind: 'op'; value: '+' | '-' | '*' | '/' | '^' }
  | { kind: 'lparen' }
  | { kind: 'rparen' }
  | { kind: 'comma' }
  | { kind: 'ident'; value: string };

const ALLOWED_FUNCS: Record<string, (...args: number[]) => number> = {
  abs: Math.abs,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  exp: Math.exp,
  log: Math.log,
  log10: Math.log10,
  log2: Math.log2,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sign: Math.sign,
  min: Math.min,
  max: Math.max,
};

const ALLOWED_CONSTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
  phi: (1 + Math.sqrt(5)) / 2,
};

const MAX_EXPR_LEN = 200;
const MAX_TOKENS = 200;
const MAX_DEPTH = 32;

function tokenize(input: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i]!;
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }

    if (c >= '0' && c <= '9') {
      let j = i;
      while (j < input.length && /[0-9.]/.test(input[j]!)) j++;
      const num = Number(input.slice(i, j));
      if (!Number.isFinite(num)) throw new Error('bad number');
      out.push({ kind: 'num', value: num });
      i = j;
      continue;
    }

    if (c === '.' && i + 1 < input.length && /[0-9]/.test(input[i + 1]!)) {
      let j = i;
      while (j < input.length && /[0-9.]/.test(input[j]!)) j++;
      const num = Number(input.slice(i, j));
      if (!Number.isFinite(num)) throw new Error('bad number');
      out.push({ kind: 'num', value: num });
      i = j;
      continue;
    }

    if (c === '+' || c === '-' || c === '*' || c === '/' || c === '^') {
      out.push({ kind: 'op', value: c });
      i++;
      continue;
    }
    if (c === '(') { out.push({ kind: 'lparen' }); i++; continue; }
    if (c === ')') { out.push({ kind: 'rparen' }); i++; continue; }
    if (c === ',') { out.push({ kind: 'comma' }); i++; continue; }

    if (/[a-zA-Z_]/.test(c)) {
      let j = i;
      while (j < input.length && /[a-zA-Z0-9_]/.test(input[j]!)) j++;
      out.push({ kind: 'ident', value: input.slice(i, j).toLowerCase() });
      i = j;
      continue;
    }

    throw new Error(`unexpected char: ${c}`);
  }
  return out;
}

class Parser {
  private pos = 0;
  private depth = 0;
  constructor(private tokens: Token[]) {}

  parse(): number {
    const v = this.parseExpr();
    if (this.pos !== this.tokens.length) throw new Error('trailing tokens');
    return v;
  }

  private parseExpr(): number {
    let left = this.parseTerm();
    while (this.pos < this.tokens.length) {
      const t = this.tokens[this.pos]!;
      if (t.kind === 'op' && (t.value === '+' || t.value === '-')) {
        this.pos++;
        const right = this.parseTerm();
        left = t.value === '+' ? left + right : left - right;
      } else break;
    }
    return left;
  }

  private parseTerm(): number {
    let left = this.parseUnary();
    while (this.pos < this.tokens.length) {
      const t = this.tokens[this.pos]!;
      if (t.kind === 'op' && (t.value === '*' || t.value === '/' || t.value === '^')) {
        this.pos++;
        const right = this.parseUnary();
        if (t.value === '*') left = left * right;
        else if (t.value === '/') {
          if (right === 0) throw new Error('division by zero');
          left = left / right;
        } else {
          left = Math.pow(left, right);
        }
      } else break;
    }
    return left;
  }

  private parseUnary(): number {
    const t = this.tokens[this.pos];
    if (!t) throw new Error('unexpected end');
    if (t.kind === 'op' && t.value === '-') { this.pos++; return -this.parseUnary(); }
    if (t.kind === 'op' && t.value === '+') { this.pos++; return this.parseUnary(); }
    return this.parsePrimary();
  }

  private parsePrimary(): number {
    this.depth++;
    if (this.depth > MAX_DEPTH) throw new Error('too deep');
    try {
      const t = this.tokens[this.pos];
      if (!t) throw new Error('unexpected end');

      if (t.kind === 'num') { this.pos++; return t.value; }

      if (t.kind === 'lparen') {
        this.pos++;
        const v = this.parseExpr();
        const close = this.tokens[this.pos];
        if (!close || close.kind !== 'rparen') throw new Error('missing )');
        this.pos++;
        return v;
      }

      if (t.kind === 'ident') {
        this.pos++;
        const name = t.value;
        const next = this.tokens[this.pos];

        if (next && next.kind === 'lparen') {
          const fn = ALLOWED_FUNCS[name];
          if (!fn) throw new Error(`unknown function: ${name}`);
          this.pos++;
          const args: number[] = [];
          if (this.tokens[this.pos]?.kind !== 'rparen') {
            args.push(this.parseExpr());
            while (this.tokens[this.pos]?.kind === 'comma') {
              this.pos++;
              args.push(this.parseExpr());
            }
          }
          const close = this.tokens[this.pos];
          if (!close || close.kind !== 'rparen') throw new Error('missing )');
          this.pos++;
          return fn(...args);
        }

        const constVal = ALLOWED_CONSTS[name];
        if (constVal === undefined) throw new Error(`unknown identifier: ${name}`);
        return constVal;
      }

      throw new Error('unexpected token');
    } finally {
      this.depth--;
    }
  }
}

export function safeEvalFormula(expr: string): number {
  if (typeof expr !== 'string') throw new Error('not a string');
  const trimmed = expr.trim();
  if (!trimmed) throw new Error('empty');
  if (trimmed.length > MAX_EXPR_LEN) throw new Error('too long');

  const tokens = tokenize(trimmed);
  if (tokens.length === 0) throw new Error('no tokens');
  if (tokens.length > MAX_TOKENS) throw new Error('too many tokens');

  const value = new Parser(tokens).parse();
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('not a finite number');
  }
  return value;
}

// ============================================================
// input_number
// ============================================================

function checkNumber(payload: unknown, userAnswer: unknown): CheckResult {
  const p = payload as { correct: number; tolerance?: number };
  const raw = typeof userAnswer === 'string' ? userAnswer.trim() : userAnswer;
  const parsed = parseNumber(raw);
  if (parsed === null) {
    return { isCorrect: false, partialScore: 0, normalizedUserAnswer: raw };
  }
  const tolerance = p.tolerance ?? EPSILON_DEFAULT;
  const diff = Math.abs(parsed - p.correct);
  const isCorrect = diff <= tolerance + EPSILON_DEFAULT;
  return { isCorrect, partialScore: isCorrect ? 1 : 0, normalizedUserAnswer: parsed };
}

function parseNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return raw;
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    .replace(/\s+/g, '')
    .replace(/,/g, '.')
    .replace(/−/g, '-')
    .replace(/[^\d.\-+eE]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// ============================================================
// input_text
// ============================================================

function checkText(payload: unknown, userAnswer: unknown): CheckResult {
  const p = payload as {
    correct: string[];
    caseSensitive?: boolean;
    regex?: string;
  };
  const raw = typeof userAnswer === 'string' ? userAnswer : '';
  const trimmed = raw.trim();

  let isCorrect = false;

  if (p.regex) {
    try {
      const re = new RegExp(p.regex, p.caseSensitive ? '' : 'i');
      isCorrect = re.test(trimmed);
    } catch {
      isCorrect = false;
    }
  }

  if (!isCorrect) {
    const normalize = (s: string): string => {
      let v = s.trim().replace(/\s+/g, ' ');
      if (!p.caseSensitive) v = v.toLowerCase();
      v = v.replace(/ё/g, 'е');
      return v;
    };
    const userNorm = normalize(trimmed);
    isCorrect = p.correct.some((c) => normalize(c) === userNorm);
  }

  return { isCorrect, partialScore: isCorrect ? 1 : 0, normalizedUserAnswer: trimmed };
}

// ============================================================
// single_choice
// ============================================================

function checkSingle(payload: unknown, userAnswer: unknown): CheckResult {
  const p = payload as { options: Array<{ id: string }>; correct: string };
  const ans = typeof userAnswer === 'string' ? userAnswer : null;
  const isCorrect = ans === p.correct;
  return { isCorrect, partialScore: isCorrect ? 1 : 0, normalizedUserAnswer: ans };
}

// ============================================================
// multi_choice
// ============================================================

function checkMulti(payload: unknown, userAnswer: unknown): CheckResult {
  const p = payload as {
    options: Array<{ id: string }>;
    correct: string[];
    partialCredit?: boolean;
  };
  const rawArr = Array.isArray(userAnswer) ? userAnswer : [];
  const userSet = new Set(rawArr.filter((x): x is string => typeof x === 'string'));
  const correctSet = new Set(p.correct);

  const intersect = [...userSet].filter((x) => correctSet.has(x)).length;
  const union = new Set([...userSet, ...correctSet]).size;

  const exact = userSet.size === correctSet.size && intersect === correctSet.size;
  if (exact) {
    return { isCorrect: true, partialScore: 1, normalizedUserAnswer: [...userSet] };
  }

  if (p.partialCredit && union > 0) {
    const score = Math.max(0, (intersect - (userSet.size - intersect)) / correctSet.size);
    return {
      isCorrect: false,
      partialScore: Math.min(1, Math.max(0, score)),
      normalizedUserAnswer: [...userSet],
    };
  }

  return { isCorrect: false, partialScore: 0, normalizedUserAnswer: [...userSet] };
}

// ============================================================
// matching
// ============================================================

function checkMatching(payload: unknown, userAnswer: unknown): CheckResult {
  const p = payload as {
    left: string[];
    right: string[];
    correct: Record<string, string>;
  };
  const ans = (userAnswer && typeof userAnswer === 'object' ? userAnswer : {}) as Record<
    string,
    string
  >;
  const total = Object.keys(p.correct).length;
  if (total === 0) {
    return { isCorrect: false, partialScore: 0, normalizedUserAnswer: ans };
  }
  let correctCount = 0;
  for (const [left, right] of Object.entries(p.correct)) {
    if (ans[left] === right) correctCount += 1;
  }
  const isCorrect = correctCount === total;
  return { isCorrect, partialScore: correctCount / total, normalizedUserAnswer: ans };
}

// ============================================================
// ordering
// ============================================================

function checkOrdering(payload: unknown, userAnswer: unknown): CheckResult {
  const p = payload as { items: string[]; correct: number[] };
  const ans = Array.isArray(userAnswer) ? userAnswer : [];
  const total = p.correct.length;
  if (total === 0) return { isCorrect: false, partialScore: 0, normalizedUserAnswer: ans };
  let correctPositions = 0;
  for (let i = 0; i < total; i++) {
    if (ans[i] === p.correct[i]) correctPositions += 1;
  }
  const isCorrect = correctPositions === total;
  return {
    isCorrect,
    partialScore: correctPositions / total,
    normalizedUserAnswer: ans,
  };
}

// ============================================================
// formula
// ============================================================

function checkFormula(payload: unknown, userAnswer: unknown): CheckResult {
  const p = payload as { correct: string; variables?: string[] };
  const raw = typeof userAnswer === 'string' ? userAnswer.trim() : '';
  if (!raw) {
    return { isCorrect: false, partialScore: 0, normalizedUserAnswer: raw };
  }
  try {
    const userValue = safeEvalFormula(raw);
    const correctValue = safeEvalFormula(p.correct);
    const isCorrect = Math.abs(userValue - correctValue) <= 1e-6;
    return { isCorrect, partialScore: isCorrect ? 1 : 0, normalizedUserAnswer: raw };
  } catch {
    return { isCorrect: false, partialScore: 0, normalizedUserAnswer: raw };
  }
}

// ============================================================
// Публичный API
// ============================================================

export function checkAnswer(
  question: Pick<Question, 'type' | 'payload'>,
  userAnswer: unknown
): CheckResult {
  switch (question.type) {
    case 'input_number': return checkNumber(question.payload, userAnswer);
    case 'input_text': return checkText(question.payload, userAnswer);
    case 'single_choice': return checkSingle(question.payload, userAnswer);
    case 'multi_choice': return checkMulti(question.payload, userAnswer);
    case 'matching': return checkMatching(question.payload, userAnswer);
    case 'ordering': return checkOrdering(question.payload, userAnswer);
    case 'formula': return checkFormula(question.payload, userAnswer);
    default:
      return { isCorrect: false, partialScore: 0, normalizedUserAnswer: userAnswer };
  }
}

export function getCorrectAnswer(question: Pick<Question, 'type' | 'payload'>): unknown {
  const p = question.payload as Record<string, unknown>;
  switch (question.type) {
    case 'input_number': return p.correct;
    case 'input_text': return (p.correct as string[])?.[0] ?? '';
    case 'single_choice': return p.correct;
    case 'multi_choice': return p.correct;
    case 'matching': return p.correct;
    case 'ordering': return p.correct;
    case 'formula': return p.correct;
    default: return null;
  }
}

/**
 * Санитизация payload перед отдачей клиенту.
 * Убирает correct, regex, tolerance.
 */
export function sanitizePayloadForClient(
  question: Pick<Question, 'type' | 'payload'>
): Record<string, unknown> {
  const p = { ...(question.payload as Record<string, unknown>) };
  delete p.correct;
  delete p.regex;
  delete p.tolerance;
  return p;
}