#!/usr/bin/env bash
# Creates a single DocAgent.app on the Desktop with custom icon.
set -e

PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP="$HOME/Desktop"
APP_PATH="$DESKTOP/DocAgent.app"
ICON_PNG="$PROJECT/assets/icon.png"
ICNS_PATH="$PROJECT/assets/icon.icns"
LAUNCH_SH="$PROJECT/scripts/launch.sh"

# Remove previous launchers (single-icon policy)
rm -rf "$APP_PATH" "$DESKTOP/DocAgent Kapat.app"

# 1. Build icon
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

chmod +x "$LAUNCH_SH"

# 2. Build the app
echo "→ DocAgent.app oluşturuluyor"
osacompile -o "$APP_PATH" -e "do shell script \"'$LAUNCH_SH'\""

cp "$ICNS_PATH" "$APP_PATH/Contents/Resources/applet.icns"
/usr/libexec/PlistBuddy -c "Set :CFBundleIconFile applet" \
  "$APP_PATH/Contents/Info.plist" 2>/dev/null || \
/usr/libexec/PlistBuddy -c "Add :CFBundleIconFile string applet" \
  "$APP_PATH/Contents/Info.plist"

# Background-only: no Dock icon, no menu bar
/usr/libexec/PlistBuddy -c "Add :LSUIElement bool true" \
  "$APP_PATH/Contents/Info.plist" 2>/dev/null || true

touch "$APP_PATH"

/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister \
  -f "$APP_PATH" 2>/dev/null || true

echo ""
echo "✓ DocAgent.app masaüstünde hazır."
echo "  Çift tıkla → tarayıcı açılır."
echo "  Tarayıcı sekmesini kapatınca sunucular otomatik durur."
