#!/bin/bash
# Deploy the built artifacts into the vault and PROVE they landed.
# A green build installs nothing — this is the step that does.
set -euo pipefail
cd "$(dirname "$0")/.."

VAULT="${GYM_VAULT_PATH:-$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents/Pienaar Vault}"
DEST="$VAULT/.obsidian/plugins/gym-app"

[ -f main.js ] || { echo "main.js missing — run ./build.sh first" >&2; exit 1; }
mkdir -p "$DEST"

for f in main.js styles.css manifest.json; do
  cp "$f" "$DEST/$f"
done

# Byte-identical proof: the vault runs what was built, or the deploy failed.
fail=0
for f in main.js styles.css manifest.json; do
  a=$(shasum -a 256 "$f" | cut -d' ' -f1)
  b=$(shasum -a 256 "$DEST/$f" | cut -d' ' -f1)
  if [ "$a" = "$b" ]; then echo "  ok   $f  $a"; else echo "  DRIFT $f" >&2; fail=1; fi
done
[ "$fail" = 0 ] || exit 1

echo "Deployed to $DEST"
echo "In Obsidian: Settings → Community plugins → enable 'Gym Vault' (then reload if it was already on)."
