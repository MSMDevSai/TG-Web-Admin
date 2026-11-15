#!/bin/sh
# تست‌های محلی منطق پروژه روی یک SDK ساختگی (mock) + SQLite واقعی. به شبکه/تلگرام وصل نمی‌شه.
# اجرا از ریشه‌ی پروژه:  sh dev/test.sh      (نیاز: Node 22.5+)
set -e
T=$(mktemp -d)
cp -r tgcloud "$T/tgcloud"
mkdir -p "$T/node_modules" && cp -r dev/mock-sdk "$T/node_modules/sdk"
cp dev/run.mjs "$T/run.mjs"
echo '{"type":"module"}' > "$T/package.json"
cd "$T" && node --experimental-sqlite --no-warnings run.mjs
