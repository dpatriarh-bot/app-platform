#!/usr/bin/env bash
# ============================================================
# generate-self-signed.sh — самоподписанный сертификат для dev
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

if [ -f fullchain.pem ] && [ -f privkey.pem ]; then
  echo "⚠️  Сертификаты уже существуют. Пропускаю."
  exit 0
fi

echo "🔐 Генерирую самоподписанный сертификат..."

openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout privkey.pem \
  -out fullchain.pem \
  -subj "//C=RU\ST=Moscow\L=Moscow\O=Ulybka Rebenka\CN=localhost" \
  -addext "subjectAltName=DNS:localhost,DNS:*.localhost,IP:127.0.0.1" \

chmod 644 fullchain.pem
chmod 600 privkey.pem

echo "✅ Сертификаты созданы:"
echo "   ${SCRIPT_DIR}/fullchain.pem"
echo "   ${SCRIPT_DIR}/privkey.pem"
echo ""
echo "⚠️  Для production используйте Let's Encrypt (certbot) или сертификат от CA."