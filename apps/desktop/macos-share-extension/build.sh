#!/bin/bash
# Builds the two macOS Share Extensions (ShareToDevices.appex, AddToCloud.appex) from the shared Swift
# template and drops them into $1 (the built AllieMinate.app's Contents/PlugIns/, created if missing).
# Called from build-app.sh after the main .app bundle is assembled but before its own top-level codesign,
# so the extensions end up inside the SAME signing pass as the host app (Contents/PlugIns/*.appex get
# signed individually here first, then swept up when build-app.sh ad-hoc signs the whole .app afterward).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGINS_DIR="$1"
if [ -z "$PLUGINS_DIR" ]; then
  echo "usage: build.sh <path to Contents/PlugIns>" >&2
  exit 1
fi
mkdir -p "$PLUGINS_DIR"

build_extension() {
  local name="$1"       # e.g. ShareToDevices
  local kind="$2"        # 'device' | 'cloud'
  local src_dir="$SCRIPT_DIR/$name"
  local appex="$PLUGINS_DIR/$name.appex"
  local build_dir
  build_dir="$(mktemp -d)"
  trap 'rm -rf "$build_dir"' RETURN

  sed "s/__KIND__/$kind/" "$SCRIPT_DIR/ShareRequestHandler.swift.template" > "$build_dir/ShareRequestHandler.swift"

  mkdir -p "$appex/Contents/MacOS"
  cp "$src_dir/Info.plist" "$appex/Contents/Info.plist"

  # App Extensions are loaded as Mach-O bundles (MH_BUNDLE), not standalone executables — pluginkit loads
  # the extension host process and dlopen()s this, then instantiates NSExtensionPrincipalClass out of it.
  # -emit-library + -Xlinker -bundle is the documented non-Xcode way to get swiftc to produce that instead
  # of its default dylib/executable output.
  swiftc -O -emit-library -Xlinker -bundle -o "$appex/Contents/MacOS/$name" "$build_dir/ShareRequestHandler.swift" \
    -framework AppKit -framework Foundation

  codesign --force --deep --sign - "$appex" >/dev/null
  echo "built $appex"
}

build_extension ShareToDevices device
build_extension AddToCloud cloud
