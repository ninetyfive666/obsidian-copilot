#!/usr/bin/env bash
set -euo pipefail

# Builds the plugin (styles + bundle) and packages main.js, manifest.json and
# styles.css into copilot-local-only.zip for dropping into an Obsidian vault.
cd "$(dirname "$0")/.."

npm run build

OUT="copilot-local-only.zip"
rm -f "$OUT"

if command -v zip >/dev/null 2>&1; then
  zip -q "$OUT" main.js manifest.json styles.css
elif command -v python3 >/dev/null 2>&1; then
  python3 - "$OUT" <<'EOF'
import sys, zipfile

out = sys.argv[1]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for name in ("main.js", "manifest.json", "styles.css"):
        z.write(name)
EOF
else
  cat >&2 <<'EOF'
error: neither 'zip' nor 'python3' is available to create copilot-local-only.zip.
Install one of them and re-run: npm run package
EOF
  exit 1
fi

echo "created $OUT (unzip into <vault>/.obsidian/plugins/copilot/)"
