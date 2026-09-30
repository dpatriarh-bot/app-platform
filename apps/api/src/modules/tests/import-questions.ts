// ============================================================
// import-questions.ts — расширенный импорт вопросов (CSV/XLSX)
// Поддерживает все 7 типов + difficulty/tags/imageUrl/explanation.
// Даёт детальный отчёт: строка → ошибки.
// ============================================================

import { db } from '../../db/client.js';
import { questions } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { validatePayload } from '../questions/schemas.js';
import { writeAudit } from '../audit/service.js';
import { logger } from '../../lib/logger.js';

type QuestionType =
  | 'input_number'
  | 'input_text'
  | 'single_choice'
  | 'multi_choice'
  | 'matching'
  | 'ordering'
  | 'formula';

const ALLOWED_TYPES: QuestionType[] = [
  'input_number',
  'input_text',
  'single_choice',
  'multi_choice',
  'matching',
  'ordering',
  'formula',
];

interface ParsedRow {
  type: string;
  text: string;
  payload: string;
  explanation?: string;
  difficulty?: string;
  tags?: string;
  imageUrl?: string;
}

export interface ImportRowError {
  row: number;
  message: string;
  raw?: Record<string, string>;
}

export interface ImportQuestionsResult {
  total: number;
  created: number;
  errors: ImportRowError[];
  dryRun: boolean;
}

export async function importQuestionsExtended(
  subjectId: string,
  format: 'csv' | 'xlsx',
  data: string,
  actorId: string,
  dryRun = false
): Promise<ImportQuestionsResult> {
  const rows: ParsedRow[] =
    format === 'xlsx' ? await parseXlsxExtended(data) : parseCsvExtended(data);

  if (rows.length === 0) {
    throw new AppError('EMPTY_FILE', 'Файл пустой или не содержит данных', 400);
  }

  const result: ImportQuestionsResult = {
    total: rows.length,
    created: 0,
    errors: [],
    dryRun,
  };

  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 2; // +1 header +1 человекочитаемый номер
    const r = rows[i]!;

    try {
      // 1. Тип
      const type = r.type.trim() as QuestionType;
      if (!ALLOWED_TYPES.includes(type)) {
        result.errors.push({
          row: rowNumber,
          message: `Неизвестный тип «${r.type}». Разрешены: ${ALLOWED_TYPES.join(', ')}`,
          raw: r as unknown as Record<string, string>,
        });
        continue;
      }

      // 2. Текст
      const text = (r.text ?? '').trim();
      if (text.length < 3 || text.length > 5000) {
        result.errors.push({
          row: rowNumber,
          message: `Текст вопроса должен быть 3–5000 символов (сейчас ${text.length})`,
        });
        continue;
      }

      // 3. Payload
      if (!r.payload?.trim()) {
        result.errors.push({
          row: rowNumber,
          message: 'Пустое поле payload — нужен JSON с правильным ответом',
        });
        continue;
      }

      let parsedPayload: unknown;
      try {
        parsedPayload = JSON.parse(r.payload);
      } catch (err) {
        result.errors.push({
          row: rowNumber,
          message: `payload не является валидным JSON: ${
            err instanceof Error ? err.message : 'unknown'
          }`,
        });
        continue;
      }

      // 4. Валидация payload под тип
      const check = validatePayload(type, parsedPayload);
      if (!check.success) {
        result.errors.push({
          row: rowNumber,
          message:
            'payload не соответствует типу: ' +
            check.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; '),
        });
        continue;
      }

      // 5. Difficulty
      let difficulty = 2;
      if (r.difficulty !== undefined && r.difficulty !== '') {
        const d = parseInt(r.difficulty, 10);
        if (Number.isNaN(d) || d < 1 || d > 5) {
          result.errors.push({
            row: rowNumber,
            message: `difficulty должен быть числом 1–5 (получено «${r.difficulty}»)`,
          });
          continue;
        }
        difficulty = d;
      }

      // 6. Tags
      const tags =
        r.tags && r.tags.trim() !== ''
          ? r.tags.split('|').map((t) => t.trim()).filter(Boolean)
          : [];

      if (tags.some((t) => t.length > 32)) {
        result.errors.push({
          row: rowNumber,
          message: 'Тег длиннее 32 символов',
        });
        continue;
      }

      // 7. imageUrl
      let imageUrl: string | null = null;
      if (r.imageUrl && r.imageUrl.trim() !== '') {
        try {
          new URL(r.imageUrl.trim());
          imageUrl = r.imageUrl.trim();
        } catch {
          result.errors.push({
            row: rowNumber,
            message: `imageUrl не является валидным URL: «${r.imageUrl}»`,
          });
          continue;
        }
      }

      // 8. Insert (если не dry-run)
      if (!dryRun) {
        await db.insert(questions).values({
          subjectId,
          type,
          text,
          payload: check.data as Record<string, unknown>,
          explanation: r.explanation?.trim() || null,
          difficulty,
          tags,
          imageUrl,
          isActive: true,
          createdBy: actorId,
        });
      }

      result.created += 1;
    } catch (err) {
      result.errors.push({
        row: rowNumber,
        message: err instanceof Error ? err.message : 'Ошибка разбора',
      });
    }
  }

  await writeAudit({
    actorId,
    action: dryRun ? 'test.import_dryrun' : 'test.import',
    entity: 'subject',
    entityId: subjectId,
    after: {
      format,
      total: result.total,
      created: result.created,
      errors: result.errors.length,
    },
  });

  logger.info(
    { subjectId, format, total: result.total, created: result.created, errors: result.errors.length, dryRun },
    'questions import finished'
  );

  return result;
}

// ============================================================
// CSV PARSER
// ============================================================

function parseCsvExtended(csv: string): ParsedRow[] {
  const lines = splitCsvLines(csv);
  if (lines.length === 0) throw new AppError('EMPTY_CSV', 'Пустой CSV', 400);

  const header = parseCsvLine(lines[0]!).map((h) => h.trim().toLowerCase());
  const required = ['type', 'text', 'payload'];
  for (const col of required) {
    if (!header.includes(col)) {
      throw new AppError(
        'INVALID_CSV',
        `Отсутствует обязательная колонка «${col}»`,
        400
      );
    }
  }

  const idx = {
    type: header.indexOf('type'),
    text: header.indexOf('text'),
    payload: header.indexOf('payload'),
    explanation: header.indexOf('explanation'),
    difficulty: header.indexOf('difficulty'),
    tags: header.indexOf('tags'),
    imageUrl: header.indexOf('imageurl'),
  };

  const rows: ParsedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i]!;
    if (raw.trim() === '') continue;

    const cells = parseCsvLine(raw);
    rows.push({
      type: cells[idx.type] ?? '',
      text: cells[idx.text] ?? '',
      payload: cells[idx.payload] ?? '',
      explanation: idx.explanation >= 0 ? cells[idx.explanation] : undefined,
      difficulty: idx.difficulty >= 0 ? cells[idx.difficulty] : undefined,
      tags: idx.tags >= 0 ? cells[idx.tags] : undefined,
      imageUrl: idx.imageUrl >= 0 ? cells[idx.imageUrl] : undefined,
    });
  }

  return rows;
}

/**
 * Разбивает CSV на строки с учётом многострочных полей в кавычках.
 */
function splitCsvLines(csv: string): string[] {
  const lines: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i]!;

    if (ch === '"') {
      current += ch;
      if (inQuotes && csv[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && csv[i + 1] === '\n') i++;
      lines.push(current);
      current = '';
      continue;
    }

    current += ch;
  }

  if (current !== '') lines.push(current);

  return lines;
}

/**
 * Парсит одну CSV-строку в массив ячеек (RFC 4180).
 */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
      continue;
    }

    current += ch;
  }
  result.push(current);
  return result;
}

// ============================================================
// XLSX PARSER
// ============================================================

async function parseXlsxExtended(base64OrDataUrl: string): Promise<ParsedRow[]> {
  let XLSX: typeof import('xlsx');
  try {
    XLSX = await import('xlsx');
  } catch {
    throw new AppError(
      'XLSX_NOT_SUPPORTED',
      'Пакет xlsx не установлен на сервере',
      500
    );
  }

  const raw = base64OrDataUrl.startsWith('data:')
    ? base64OrDataUrl.split(',')[1] ?? ''
    : base64OrDataUrl;

  const buffer = Buffer.from(raw, 'base64');

  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new AppError('EMPTY_XLSX', 'В файле нет листов', 400);

  const sheet = wb.Sheets[sheetName];
  if (!sheet) throw new AppError('EMPTY_XLSX', 'Лист пустой', 400);

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: false,
    defval: '',
  });

  if (matrix.length < 2) {
    throw new AppError('EMPTY_XLSX', 'В файле нет данных', 400);
  }

  const header = (matrix[0] as unknown[]).map((x) => String(x).trim().toLowerCase());
  const required = ['type', 'text', 'payload'];
  for (const col of required) {
    if (!header.includes(col)) {
      throw new AppError('INVALID_XLSX', `Отсутствует колонка «${col}»`, 400);
    }
  }

  const idx = {
    type: header.indexOf('type'),
    text: header.indexOf('text'),
    payload: header.indexOf('payload'),
    explanation: header.indexOf('explanation'),
    difficulty: header.indexOf('difficulty'),
    tags: header.indexOf('tags'),
    imageUrl: header.indexOf('imageurl'),
  };

  const rows: ParsedRow[] = [];
  for (let i = 1; i < matrix.length; i++) {
    const r = matrix[i] as unknown[];
    const cell = (col: number): string =>
      col >= 0 && r[col] !== undefined && r[col] !== null ? String(r[col]) : '';

    rows.push({
      type: cell(idx.type),
      text: cell(idx.text),
      payload: cell(idx.payload),
      explanation: idx.explanation >= 0 ? cell(idx.explanation) : undefined,
      difficulty: idx.difficulty >= 0 ? cell(idx.difficulty) : undefined,
      tags: idx.tags >= 0 ? cell(idx.tags) : undefined,
      imageUrl: idx.imageUrl >= 0 ? cell(idx.imageUrl) : undefined,
    });
  }

  return rows;
}