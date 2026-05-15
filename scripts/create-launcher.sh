#!/usr/bin/env bash
# Creates DocAgent.app + DocAgent Kapat.app on the Desktop.
# DocAgent.app  → starts servers + opens browser
# DocAgent Kapat.app → stops servers
set -e

PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP="$HOME/Desktop"
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

LAUNCH_SH="$PROJECT/scripts/launch.sh"
STOP_SH="$PROJECT/scripts/stop.sh"
chmod +x "$LAUNCH_SH" "$STOP_SH"

build_app() {
  local app_name="$1"
  local script_path="$2"
  local app_path="$DESKTOP/$app_name.app"

  echo "→ $app_name.app oluşturuluyor"

  rm -rf "$app_path"
  local applescript="do shell script \"'$script_path'\""
  osacompile -o "$app_path" -e "$applescript"

  # Inject icon
  cp "$ICNS_PATH" "$app_path/Contents/Resources/applet.icns"
  /usr/libexec/PlistBuddy -c "Set :CFBundleIconFile applet" \
    "$app_path/Contents/Info.plist" 2>/dev/null || \
  /usr/libexec/PlistBuddy -c "Add :CFBundleIconFile string applet" \
    "$app_path/Contents/Info.plist"

  # LSUIElement = true → don't show in Dock when running (background app)
  /usr/libexec/PlistBuddy -c "Add :LSUIElement bool true" \
    "$app_path/Contents/Info.plist" 2>/dev/null || true

  touch "$app_path"
}

build_app "DocAgent"        "$LAUNCH_SH"
build_app "DocAgent Kapat"  "$STOP_SH"

# Refresh Finder cache
/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister \
  -f "$DESKTOP/DocAgent.app" "$DESKTOP/DocAgent Kapat.app" 2>/dev/null || true

echo ""
echo "✓ Masaüstünde hazır:"
echo "  • DocAgent.app        → sunucuları başlatır + tarayıcı açar"
echo "  • DocAgent Kapat.app  → sunucuları durdurur"
echo ""
echo "Log: $PROJECT/data/logs/"
