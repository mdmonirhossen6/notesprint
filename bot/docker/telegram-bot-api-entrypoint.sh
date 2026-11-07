#!/usr/bin/env bash
set -euo pipefail

: "${TELEGRAM_API_ID:?TELEGRAM_API_ID must be set}"
: "${TELEGRAM_API_HASH:?TELEGRAM_API_HASH must be set}"

exec telegram-bot-api \
  --local \
  --http-ip=0.0.0.0 \
  --http-port=8081 \
  --dir=/var/lib/telegram-bot-api \
  --api-id="$TELEGRAM_API_ID" \
  --api-hash="$TELEGRAM_API_HASH"
