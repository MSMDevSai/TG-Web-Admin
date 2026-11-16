#!/bin/sh
# تست رابط کاربری واقعی در Chromium (Playwright) روی SDK ساختگی. اسکرین‌شات‌ها در $SHOTS_DIR (پیش‌فرض /tmp/shots).
# پیش‌نیاز: npm i -D playwright && npx playwright install chromium
# اجرا از ریشه‌ی پروژه:  sh dev/ui-test.sh      (اگر playwright جای دیگری نصب است: PW_DIR=/مسیر/node_modules/x.js)
set -e
ROOT=$(pwd)
PW_DIR="${PW_DIR:-$ROOT/node_modules/x.js}"; export PW_DIR
T=$(mktemp -d)
cp -r tgcloud "$T/tgcloud"
mkdir -p "$T/node_modules" && cp -r dev/mock-sdk "$T/node_modules/sdk"
cp dev/ui/ui.mjs dev/ui/sample.png "$T/"
echo '{"type":"module"}' > "$T/package.json"
cd "$T" && WEB_DIR="${WEB_DIR:-$ROOT/web}" node --experimental-sqlite --no-warnings ui.mjs
