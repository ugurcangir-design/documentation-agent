#!/usr/bin/env bash
# Creates DocAgent.app on the Desktop — double-click launches the Electron app.
set -e

PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="DocAgent"
DESKTOP="$HOME/Desktop"
APP_PATH="$DESKTOP/$APP_NAME.app"
ICON_PNG="$PROJECT/assets/icon.png"
ICNS_PATH="$PROJECT/assets/icon.icns"

# ── 1. PNG → ICNS ────────────────────────────────────────────────────────────
echo "→ Building icon..."
ICONSET_DIR=$(mktemp -d)
ICONSET="$ICONSET_DIR/DocAgent.iconset"
mkdir -p "$ICONSET"

for s in 16 32 64 128 256 512 1024; do
  sips -z $s $s "$ICON_PNG" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null 2>&1
  half=$((s / 2))
  [ $half -ge 16 ] && \
    sips -z $s $s "$ICON_PNG" --out "$ICONSET/icon_${half}x${half}@2x.png" >/dev/null 2>&1
done

iconutil -c icns "$ICONSET" -o "$ICNS_PATH"
rm -rf "$ICONSET_DIR"
echo "   icon.icns oluşturuldu."

# ── 2. Find Electron binary ──────────────────────────────────────────────────
ELECTRON_BIN="$PROJECT/node_modules/.bin/electron"
NODE_BIN="$(which node 2>/dev/null || echo /usr/local/bin/node)"

if [ ! -f "$ELECTRON_BIN" ]; then
  echo "HATA: Electron binary bulunamadı: $ELECTRON_BIN"
  echo "Önce 'npm install' çalıştır."
  exit 1
fi

# ── 3. Launcher shell script ─────────────────────────────────────────────────
LAUNCHER_SH="$PROJECT/scripts/launch.sh"
cat > "$LAUNCHER_SH" <<SHELLSCRIPT
#!/usr/bin/env bash
export PATH="/usr/local/bin:/opt/homebrew/bin:\$PATH"
cd "$PROJECT"
"$NODE_BIN" scripts/generate-icon.cjs 2>/dev/null || true
exec "$ELECTRON_BIN" . >> /tmp/docagent.log 2>&1
SHELLSCRIPT
chmod +x "$LAUNCHER_SH"

# ── 4. Compile AppleScript app ───────────────────────────────────────────────
echo "→ Launcher app oluşturuluyor: $APP_PATH"

APPLESCRIPT="do shell script \"'$LAUNCHER_SH' &> /tmp/docagent.log &\""
osacompile -o "$APP_PATH" -e "$APPLESCRIPT"

# ── 5. Inject custom icon ────────────────────────────────────────────────────
echo "→ İkon yerleştiriliyor..."
cp "$ICNS_PATH" "$APP_PATH/Contents/Resources/applet.icns"

/usr/libexec/PlistBuddy -c "Set :CFBundleIconFile applet" \
  "$APP_PATH/Contents/Info.plist" 2>/dev/null || \
/usr/libexec/PlistBuddy -c "Add :CFBundleIconFile string applet" \
  "$APP_PATH/Contents/Info.plist"

# Set icon via Python + AppKit (most reliable method)
python3 - <<PYEOF
import subprocess, sys
try:
  from AppKit import NSWorkspace, NSImage
  icon = NSImage.alloc().initWithContentsOfFile_("$ICNS_PATH")
  NSWorkspace.sharedWorkspace().setIcon_forFile_options_(icon, "$APP_PATH", 0)
  print("   AppKit icon set.")
except Exception as e:
  print(f"   AppKit skip: {e}")
PYEOF

touch "$APP_PATH"

echo ""
echo "✓ $APP_NAME.app masaüstünde hazır."
echo "  Çift tıkla → Electron uygulaması başlar."
echo "  Log: /tmp/docagent.log"
