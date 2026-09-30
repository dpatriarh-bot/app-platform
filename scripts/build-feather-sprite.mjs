#!/usr/bin/env node
// ============================================================
// build-feather-sprite.mjs
// Собирает apps/web/public/icons/feather-sprite.svg
// из отдельных .svg-файлов в apps/web/public/icons/feather/.
//
// Запуск (из корня проекта):
//   node scripts/build-feather-sprite.mjs
//
// Плюсы: не зависит от bash-эскейпинга, работает одинаково
// на Windows / Linux / macOS.
// ============================================================

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';

const ROOT = process.cwd();
const SRC_DIR = resolve(ROOT, process.argv[2] ?? 'apps/web/public/icons/feather');
const OUT_FILE = resolve(ROOT, process.argv[3] ?? 'apps/web/public/icons/feather-sprite.svg');

async function main() {
  if (!existsSync(SRC_DIR)) {
    console.error(`❌ Не найдена папка: ${SRC_DIR}`);
    process.exit(1);
  }

  const files = (await readdir(SRC_DIR))
    .filter((f) => f.endsWith('.svg'))
    .sort();

  console.log(`→ Источник: ${SRC_DIR}`);
  console.log(`→ Файлов: ${files.length}`);
  console.log(`→ Цель: ${OUT_FILE}`);
  console.log('');

  const symbols = [];
  let skipped = 0;

  for (const file of files) {
    const id = basename(file, '.svg');
    const raw = await readFile(join(SRC_DIR, file), 'utf8');

    // Убираем XML-декларацию, комментарии и всё, что вне <svg>...</svg>.
    const svgMatch = raw.match(/<svg\b[^>]*>([\s\S]*?)<\/svg>/i);
    if (!svgMatch) {
      console.warn(`⚠️  Нет <svg>: ${id}`);
      skipped++;
      continue;
    }

    // Внутренности SVG. Убираем пробелы/переносы, но сохраняем теги.
    const inner = svgMatch[1]
      .replace(/\r?\n/g, '')   // переносы строк
      .replace(/\s{2,}/g, ' ') // множественные пробелы
      .trim();

    if (!inner) {
      console.warn(`⚠️  Пусто: ${id}`);
      skipped++;
      continue;
    }

    // Feather-стандарт: 24x24, stroke-based.
    // Внутри исходных SVG нет <title>, только фигуры — отлично.
    symbols.push(
      `  <symbol id="${id}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</symbol>`
    );
  }

  const output = [
    '<svg xmlns="http://www.w3.org/2000/svg" style="display:none">',
    ...symbols,
    '</svg>',
    '',
  ].join('\n');

  await writeFile(OUT_FILE, output, 'utf8');

  console.log(`✅ Собрано: ${symbols.length} символов`);
  if (skipped > 0) console.log(`⚠️  Пропущено: ${skipped}`);
  console.log(`📄 Файл: ${OUT_FILE}`);
  console.log(`📏 Размер: ${(Buffer.byteLength(output) / 1024).toFixed(1)} KB`);
}

main().catch((err) => {
  console.error('❌ Ошибка:', err);
  process.exit(1);
});