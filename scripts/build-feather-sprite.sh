#!/usr/bin/env bash
# ============================================================
# build-feather-sprite.sh
# Собирает apps/web/public/icons/feather-sprite.svg
# из отдельных .svg-файлов в apps/web/public/icons/feather/.
#
# Запуск (из корня проекта):
#   chmod +x scripts/build-feather-sprite.sh
#   ./scripts/build-feather-sprite.sh
# ============================================================

set -euo pipefail

SRC_DIR="${1:-apps/web/public/icons/feather}"
OUT="${2:-apps/web/public/icons/feather-sprite.svg}"

if [ ! -d "$SRC_DIR" ]; then
  echo "❌ Не найдена папка: $SRC_DIR"
  exit 1
fi

SVG_COUNT=$(ls "$SRC_DIR"/*.svg 2>/dev/null | wc -l)
if [ "$SVG_COUNT" -eq 0 ]; then
  echo "❌ В папке $SRC_DIR нет .svg-файлов"
  exit 1
fi

echo "→ Источник: $SRC_DIR"
echo "→ Файлов: $SVG_COUNT"
echo "→ Цель: $OUT"
echo

TMP="$(mktemp "${OUT}.tmp.XXXXXX")"

cat > "$TMP" <<'HEADER'
<svg xmlns="http://www.w3.org/2000/svg" style="display:none">
HEADER

count=0
skipped=0

for f in "$SRC_DIR"/*.svg; do
  [ -f "$f" ] || continue

  id="$(basename "$f" .svg)"

  # Извлекаем содержимое между <svg ...> и </svg>.
  # awk корректно работает с многострочными SVG.
  content="$(awk '
    /<svg/ { in_svg = 1; next }
    /<\/svg>/ { in_svg = 0; next }
    in_svg { printf "%s", $0 }
  ' "$f" | tr -d '\n\r' | sed 's/  */ /g' | sed 's/^ *//;s/ *$//')"

  if [ -z "$content" ]; then
    echo "⚠️  Пусто: $id"
    skipped=$((skipped + 1))
    continue
  fi

  printf '  <symbol id="%s" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">%s</symbol>\n' \
    "$id" "$content" >> "$TMP"

  count=$((count + 1))
done

echo '</svg>' >> "$TMP"

mv "$TMP" "$OUT"

echo
echo "✅ Собрано: $count символов"
[ "$skipped" -gt 0 ] && echo "⚠️  Пропущено: $skipped"
echo "📄 Файл: $OUT"
echo "📏 Размер: $(du -h "$OUT" | cut -f1)"