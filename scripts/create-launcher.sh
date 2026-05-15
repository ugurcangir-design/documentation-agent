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
ICONSET=$(mktemp -d)/DocAgent.iconset
mkdir -p "$ICONSET"

sizes=(16 32 64 128 256 512 1024)
for s in "${sizes[@]}"; do
  sips -z $s $s "$ICON_PNG" --out "$ICONSET/icon_${s}x${s}.png"     >/dev/null 2>&1
  # @2x variant (half-size label)
  half=$((s / 2))
  if [ $half -ge 16 ]; then
    sips -z $s $s "$ICON_PNG" --out "$ICONSET/icon_${half}x${half}@2x.png" >/dev/null 2>&1
  fi
done

iconutil -c icns "$ICONSET" -o "$ICNS_PATH"
echo "   icon.icns oluşturuldu."

# ── 2. AppleScript app ───────────────────────────────────────────────────────
echo "→ Launcher app oluşturuluyor: $APP_PATH"

SCRIPT=$(cat <<APPLESCRIPT
do shell script "cd '$PROJECT' && npm run electron >> /tmp/docagent.log 2>&1 &"
APPLESCRIPT
)

osacompile -o "$APP_PATH" -e "$SCRIPT"

# ── 3. Replace icon in app bundle ────────────────────────────────────────────
echo "→ İkon yerleştiriliyor..."
cp "$ICNS_PATH" "$APP_PATH/Contents/Resources/applet.icns"

# Plist'e icon adını yaz
/usr/libexec/PlistBuddy -c "Set :CFBundleIconFile applet" \
  "$APP_PATH/Contents/Info.plist" 2>/dev/null || \
/usr/libexec/PlistBuddy -c "Add :CFBundleIconFile string applet" \
  "$APP_PATH/Contents/Info.plist"

# macOS icon cache'ini temizle
touch "$APP_PATH"
/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister \
  -f "$APP_PATH" 2>/dev/null || true

echo ""
echo "✓ $APP_NAME.app masaüstünde hazır."
echo "  Çift tıkla → Electron uygulaması başlar."
echo "  Log: /tmp/docagent.log"
