#!/usr/bin/env bash
# ساخت/به‌روزرسانی Space روی Hugging Face (SDK: Gradio — بدون Docker)
#
#   ./deploy.sh <hf-username>/<space-name>
#
# پیش‌نیاز: یک توکن Hugging Face با دسترسی write در متغیر HF_TOKEN
# (یا اجرای `hf auth login` هنگام اجرای اسکریپت).
set -euo pipefail

SPACE="${1:-}"
if [ -z "$SPACE" ]; then
  echo "usage: ./deploy.sh <hf-username>/<space-name>" >&2
  exit 1
fi

python3 -m pip install -q -U huggingface_hub

if [ -z "${HF_TOKEN:-}" ]; then
  hf auth login
fi

# Space را با SDK گریدو می‌سازد (اگر از قبل باشد، دست نمی‌زند)
hf repo create "$SPACE" --repo-type space --space-sdk gradio --exist-ok

# همین پوشه را آپلود می‌کند؛ .env و فایل‌های موقت جا نمی‌مانند
hf upload "$SPACE" "$(cd "$(dirname "$0")" && pwd)" . \
  --repo-type space \
  --exclude ".env" \
  --exclude ".env.*" \
  --exclude "__pycache__/*" \
  --exclude "*.pyc"

echo
echo "✅ آپلود شد: https://huggingface.co/spaces/$SPACE"
echo "   Secrets لازم: BOT_TOKEN  |  Variables: SERVERLESS_ORIGIN, PROXY_TELEGRAM_ID"
