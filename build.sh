#!/bin/bash
# Build the plugin and run the guard suite. The build itself lives in
# esbuild.config.mjs (declared in package.json) so a verifier that clones the
# repo runs the exact same path — one path, no drift.
#
# BOTH root main.js and root styles.css are BUILD OUTPUT — edit src/ only.
#
# NOTE: a green build installs NOTHING. Deploy to the vault with
#   ./scripts/deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  if [ -f package-lock.json ]; then npm ci; else npm install; fi
fi

npm run build

# Bundle-level gates: it parses, and the tests below exercise src/ directly.
node --check main.js

npm test

echo "Built main.js + styles.css OK — run ./scripts/deploy.sh to install into the vault."
