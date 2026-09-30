// ============================================================
// csv.ts — экспорт данных в CSV (RFC 4180)
// ============================================================

export interface CsvColumn<T> {
  key: string;
  header: string;
  value: (row: T) => string | number | null | undefined;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const headerLine = columns.map((c) => escape(c.header)).join(',');
  const lines = rows.map((r) => columns.map((c) => escape(c.value(r))).join(','));
  return [headerLine, ...lines].join('\r\n');
}

export function withBom(csv: string): string {
  // Excel правильно определяет UTF-8 с BOM
  return '\uFEFF' + csv;
}