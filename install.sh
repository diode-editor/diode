#!/bin/sh
# Diode quick installer.
#
#   curl -fsSL https://raw.githubusercontent.com/diode-editor/diode/main/install.sh | sh
#
# Detects OS and CPU, downloads the matching single-file binary from GitHub Releases,
# verifies its sha256 and puts it on PATH. No package manager involved.
#
# Knobs (environment variables):
#   DIODE_VERSION      tag to install, e.g. v0.3.0 or nightly (default: latest stable release)
#   DIODE_INSTALL_DIR  where to put the binary (default: /usr/local/bin when writable, else ~/.local/bin)
#
# Windows is not served by this script: use `winget install DiodeEditor.Diode`
# or `npm install -g @diode-editor/diode`.

set -eu

REPO="diode-editor/diode"
BASE="https://github.com/${REPO}/releases"

say() { printf '%s\n' "$*" >&2; }
die() { say "install.sh: $*"; exit 1; }

# --- platform ------------------------------------------------------------------

os="$(uname -s 2>/dev/null || echo unknown)"
case "$os" in
    Linux)  os=linux ;;
    Darwin) os=macos ;;
    MINGW*|MSYS*|CYGWIN*|Windows_NT)
        die "Windows: use 'winget install DiodeEditor.Diode' or 'npm install -g @diode-editor/diode'" ;;
    *)      die "unsupported OS: $os (builds exist for Linux and macOS)" ;;
esac

arch="$(uname -m 2>/dev/null || echo unknown)"
case "$arch" in
    x86_64|amd64)  arch=x64 ;;
    aarch64|arm64) arch=arm64 ;;
    *)             die "unsupported CPU: $arch (builds exist for x64 and arm64)" ;;
esac

asset="diode-${os}-${arch}"

# --- version -------------------------------------------------------------------

version="${DIODE_VERSION:-}"
if [ -n "$version" ]; then
    case "$version" in
        v*|nightly) ;;
        *) version="v${version}" ;;
    esac
    url="${BASE}/download/${version}/${asset}"
else
    url="${BASE}/latest/download/${asset}"
fi

# --- fetch ---------------------------------------------------------------------

if command -v curl >/dev/null 2>&1; then
    fetch() { curl -fsSL --retry 3 -o "$2" "$1"; }
elif command -v wget >/dev/null 2>&1; then
    fetch() { wget -q -O "$2" "$1"; }
else
    die "need curl or wget"
fi

tmp="$(mktemp -d 2>/dev/null || mktemp -d -t diode)"
trap 'rm -rf "$tmp"' EXIT INT TERM

say "> Downloading ${url}"
fetch "$url" "$tmp/$asset" || die "download failed: $url"

# --- verify --------------------------------------------------------------------

if command -v sha256sum >/dev/null 2>&1; then
    digest() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then
    digest() { shasum -a 256 "$1" | cut -d' ' -f1; }
else
    digest() { echo ""; }
fi

if fetch "${url}.sha256" "$tmp/$asset.sha256" 2>/dev/null; then
    expected="$(cut -d' ' -f1 < "$tmp/$asset.sha256")"
    actual="$(digest "$tmp/$asset")"
    if [ -z "$actual" ]; then
        say "! No sha256sum/shasum on this machine, skipping checksum verification"
    elif [ "$expected" != "$actual" ]; then
        die "sha256 mismatch for $asset: expected $expected, got $actual"
    else
        say "> sha256 OK"
    fi
else
    say "! No checksum published for this release, skipping verification"
fi

# --- install -------------------------------------------------------------------

dir="${DIODE_INSTALL_DIR:-}"
if [ -z "$dir" ]; then
    if [ -w /usr/local/bin ]; then
        dir=/usr/local/bin
    else
        dir="$HOME/.local/bin"
    fi
fi
mkdir -p "$dir"
chmod 755 "$tmp/$asset"
mv -f "$tmp/$asset" "$dir/diode"
say "> Installed $dir/diode"

installed="$("$dir/diode" --version 2>/dev/null || true)"
[ -n "$installed" ] && say "> diode ${installed}"

case ":$PATH:" in
    *":$dir:"*) ;;
    *)
        say ""
        say "! $dir is not on your PATH. Add it to your shell profile:"
        say "    export PATH=\"$dir:\$PATH\""
        ;;
esac
