#!/usr/bin/env bash
# build_test.sh — genera build locali non firmate per test rapido
# Firefox: carica _ff/manifest.json da about:debugging (temporanea)
#          oppure installa recman_firefox_test.xpi su Firefox Dev Edition
# Chrome:  carica recman_chrome/ da chrome://extensions (non pacchettizzata)

set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

# ── Chrome ────────────────────────────────────────────────────────────────────
echo "→ Chrome: copio i file in recman_chrome/"
rm -rf "$ROOT/recman_chrome"
mkdir -p "$ROOT/recman_chrome"
cp "$ROOT/manifest.json" "$ROOT/background.js" "$ROOT/content.js" "$ROOT/README.md" \
   "$ROOT/recman_chrome/"
echo "  Fatto. Carica la cartella recman_chrome/ da chrome://extensions (modalità sviluppatore)"

# ── Firefox ───────────────────────────────────────────────────────────────────
echo "→ Firefox: copio i file in _ff/"
rm -rf "$ROOT/_ff"
mkdir -p "$ROOT/_ff"
cp "$ROOT/background.js" "$ROOT/content.js" "$ROOT/README.md" "$ROOT/_ff/"
cp "$ROOT/manifest_firefox.json" "$ROOT/_ff/manifest.json"

echo "→ Firefox: creo recman_firefox_test.xpi (non firmato)"
rm -f "$ROOT/recman_firefox_test.xpi"
cd "$ROOT/_ff" && zip -qr "$ROOT/recman_firefox_test.xpi" . && cd "$ROOT"

echo ""
echo "Build completata."
echo ""
echo "  Firefox (metodo consigliato per test):"
echo "    about:debugging → Questo Firefox → Carica componente aggiuntivo temporaneo"
echo "    → seleziona _ff/manifest.json"
echo ""
echo "  Firefox (installazione permanente, solo Dev Edition / Nightly):"
echo "    In about:config imposta xpinstall.signatures.required = false"
echo "    poi about:addons → ⚙ → Installa da file → recman_firefox_test.xpi"
echo ""
echo "  Chrome:"
echo "    chrome://extensions → Modalità sviluppatore → Carica estensione non pacchettizzata"
echo "    → seleziona la cartella recman_chrome/"
