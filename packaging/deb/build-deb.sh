#!/usr/bin/env bash
# Собирает .deb из готового linux-бинаря без сторонних инструментов (только dpkg-deb).
#
#   packaging/deb/build-deb.sh <binary> <arch: amd64|arm64> <version> <out-dir>
#
# Бинарь — self-extract сборка (`diode-linux-x64` / `diode-linux-arm64`); пакет кладёт его
# в /usr/bin/diode и объявляет рантайм-зависимости распакованного node.
# Результат: <out-dir>/diode_<version>_<arch>.deb

set -euo pipefail

binary="${1:?binary path}"
arch="${2:?amd64|arm64}"
version="${3:?version without leading v}"
out="${4:?output dir}"

[[ -f "$binary" ]] || { echo "no such file: $binary" >&2; exit 1; }
case "$arch" in amd64|arm64) ;; *) echo "arch must be amd64 or arm64" >&2; exit 1 ;; esac

root="$(mktemp -d)"
chmod 755 "$root"
trap 'rm -rf "$root"' EXIT

mkdir -p "$root/DEBIAN" "$root/usr/bin" "$root/usr/share/doc/diode"
install -m 0755 "$binary" "$root/usr/bin/diode"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$here/../.." && pwd)"
install -m 0644 "$repo_root/LICENSE" "$root/usr/share/doc/diode/copyright"

size_kb=$(( $(stat -c %s "$root/usr/bin/diode") / 1024 ))

cat > "$root/DEBIAN/control" <<CONTROL
Package: diode
Version: ${version}
Section: editors
Priority: optional
Architecture: ${arch}
Maintainer: Diode <noreply@diode-editor.github.io>
Installed-Size: ${size_kb}
Depends: libc6, libstdc++6, tar, gzip
Homepage: https://diode-editor.github.io
Description: Terminal text editor with VS Code keys, extensions and LSP
 Diode is a non-modal terminal text editor that keeps the VS Code keyboard
 layout and runs VS Code language extensions outside Electron. Single-file
 binary: Node.js runtime, TypeScript language server and ripgrep are bundled.
CONTROL

mkdir -p "$out"
dpkg-deb --build --root-owner-group "$root" "$out/diode_${version}_${arch}.deb"
