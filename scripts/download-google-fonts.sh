#!/usr/bin/env bash
# ============================================================
# download-google-fonts.sh
# Скачивает все .woff2 из google-fonts.css в apps/web/public/fonts/
# и генерирует локальный fonts.css с переписанными путями.
# Запуск: ./scripts/download-google-fonts.sh
# ============================================================

set -euo pipefail

SRC_CSS="${1:-./google-fonts.css}"
DST_DIR="${2:-./apps/web/public/fonts}"
DST_CSS="${DST_DIR}/fonts.css"

if [ ! -f "$SRC_CSS" ]; then
  echo "❌ Не найден $SRC_CSS — сначала скачайте CSS от Google (см. шаг 1)."
  exit 1
fi

mkdir -p "$DST_DIR"

# Собираем список уникальных URL'ов
mapfile -t URLS < <(grep -oE 'https://fonts\.gstatic\.com/[^)"'\'']+\.woff2' "$SRC_CSS" | sort -u)

echo "Найдено файлов: ${#URLS[@]}"
echo ""

# Соответствие URL → локальное имя
declare -A MAP

i=0
for url in "${URLS[@]}"; do
  # Имя вида: inter-cyrillic-400.woff2
  # Формат URL у Google: /s/inter/vXX/<hash>.woff2 — хэш нечитаемый,
  # поэтому строим имя из unicode-range и веса в самом CSS, а здесь — просто порядковый номер + basename.
  base=$(basename "$url")
  name="${i}_${base}"
  MAP["$url"]="$name"
  i=$((i + 1))

  echo "→ $url"
  echo "  → $name"
  curl -fsSL "$url" -o "${DST_DIR}/${name}"
done

echo ""
echo "Файлы скачаны в $DST_DIR"

# Теперь собираем локальный fonts.css: заменяем URL'ы на локальные пути
# и оставляем @font-face как есть (font-family, weight, unicode-range).
cp "$SRC_CSS" "$DST_CSS"

for url in "${!MAP[@]}"; do
  # sed с '/' в URL — используем другой разделитель
  escaped_url=$(printf '%s' "$url" | sed -e 's/[\/&]/\\&/g')
  sed -i "s|${escaped_url}|/fonts/${MAP[$url]}|g" "$DST_CSS"
done

echo ""
echo "✅ Готово."
echo ""
echo "Проверьте $DST_CSS — в нём должны быть только локальные пути /fonts/..."
echo ""
echo "Перезапустите web:"
echo "  docker compose restart web"