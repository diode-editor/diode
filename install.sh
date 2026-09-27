#!/bin/sh
# Diode installer.
#
#   curl -fsSL https://raw.githubusercontent.com/diode-editor/diode/main/install.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/diode-editor/diode/main/install.sh | sh -s -- --method=apt
#   DIODE_INSTALL_METHOD=brew sh install.sh
#
# The default (--method=binary) downloads the single-file binary for your OS and CPU from
# GitHub Releases, verifies its sha256 and puts it on PATH: no root, no package manager,
# updates by re-running the script. The other methods hand the install to a package
# manager, which then owns updates:
#
#   apt    Debian/Ubuntu: adds the Diode apt repository (keyring + sources.list.d entry)
#          and installs the package. Needs root (sudo). Always the latest stable release.
#   brew   Homebrew (macOS, Linux): brew install diode-editor/tap/diode
#   npm    npm install -g @diode-editor/diode (works on Windows too)
#
# Knobs (environment variables):
#   DIODE_INSTALL_METHOD  same as --method
#   DIODE_VERSION         binary method only: tag to install, e.g. v0.3.0 or nightly
#                         (default: latest stable release)
#   DIODE_INSTALL_DIR     binary method only: where to put the binary
#                         (default: /usr/local/bin when writable, else ~/.local/bin)
#
# Windows is not served by the binary method: use `winget install DiodeEditor.Diode`
# or --method=npm.

set -eu

REPO="diode-editor/diode"
BASE="https://github.com/${REPO}/releases"
METHOD="${DIODE_INSTALL_METHOD:-binary}"

say() { printf '%s\n' "$*" >&2; }
die() { say "install.sh: $*"; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

usage() {
    cat >&2 <<'EOF'
Usage: install.sh [--method=binary|apt|brew|npm]

  binary  (default) single-file binary from GitHub Releases, no root, no package manager
  apt     Debian/Ubuntu: add the Diode apt repository and install the package (sudo)
  brew    Homebrew (macOS, Linux): brew install diode-editor/tap/diode
  npm     npm install -g @diode-editor/diode

Environment: DIODE_INSTALL_METHOD, DIODE_VERSION, DIODE_INSTALL_DIR (see the header).
EOF
}

for arg in "$@"; do
    case "$arg" in
        --method=*) METHOD="${arg#--method=}" ;;
        --method)   die "--method needs a value, e.g. --method=apt" ;;
        -h|--help)  usage; exit 0 ;;
        *)          usage; die "unknown argument: $arg" ;;
    esac
done

# --- shared helpers ------------------------------------------------------------

if have curl; then
    fetch() { curl -fsSL --retry 3 -o "$2" "$1"; }
elif have wget; then
    fetch() { wget -q -O "$2" "$1"; }
else
    die "need curl or wget"
fi

# Run as root: directly when we are root, through sudo otherwise. sudo reads the
# password from the terminal, so this works with `curl | sh` as well.
as_root() {
    if [ "$(id -u)" -eq 0 ]; then
        "$@"
    elif have sudo; then
        sudo "$@"
    else
        die "this step needs root and sudo is not available: $*"
    fi
}

tmp="$(mktemp -d 2>/dev/null || mktemp -d -t diode)"
trap 'rm -rf "$tmp"' EXIT INT TERM

os="$(uname -s 2>/dev/null || echo unknown)"
arch="$(uname -m 2>/dev/null || echo unknown)"

# Distro family from os-release: "debian" for anything apt-based, empty otherwise.
distro_family() {
    [ -f /etc/os-release ] || return 0
    # shellcheck disable=SC1091
    . /etc/os-release
    case "${ID:-} ${ID_LIKE:-}" in
        *debian*|*ubuntu*) echo debian ;;
    esac
}

# --- binary --------------------------------------------------------------------

install_binary() {
    case "$os" in
        Linux)  asset_os=linux ;;
        Darwin) asset_os=macos ;;
        MINGW*|MSYS*|CYGWIN*|Windows_NT)
            die "Windows: use 'winget install DiodeEditor.Diode' or --method=npm" ;;
        *)      die "unsupported OS: $os (builds exist for Linux and macOS)" ;;
    esac
    case "$arch" in
        x86_64|amd64)  asset_arch=x64 ;;
        aarch64|arm64) asset_arch=arm64 ;;
        *)             die "unsupported CPU: $arch (builds exist for x64 and arm64)" ;;
    esac
    asset="diode-${asset_os}-${asset_arch}"

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

    say "> Downloading ${url}"
    fetch "$url" "$tmp/$asset" || die "download failed: $url"

    if have sha256sum; then
        digest() { sha256sum "$1" | cut -d' ' -f1; }
    elif have shasum; then
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

    dir="${DIODE_INSTALL_DIR:-}"
    if [ -z "$dir" ]; then
        if [ -w /usr/local/bin ]; then dir=/usr/local/bin; else dir="$HOME/.local/bin"; fi
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

    case "$(distro_family)" in
        debian) say "> Prefer updates through apt? Re-run with --method=apt" ;;
    esac
    [ "$os" = Darwin ] && have brew && say "> Prefer Homebrew? Re-run with --method=brew"
    return 0
}

# --- apt -----------------------------------------------------------------------

install_apt() {
    have apt-get || die "apt-get not found; this does not look like a Debian/Ubuntu system"
    have dpkg || die "dpkg not found; this does not look like a Debian/Ubuntu system"
    [ -n "${DIODE_VERSION:-}" ] && die "the apt repository serves the latest stable release only; drop DIODE_VERSION or use --method=binary"
    case "$(dpkg --print-architecture)" in
        amd64|arm64) ;;
        *) die "no .deb for $(dpkg --print-architecture) (packages exist for amd64 and arm64); try --method=binary" ;;
    esac

    keyring_url="${BASE}/latest/download/diode-archive-keyring.gpg"
    say "> Downloading ${keyring_url}"
    fetch "$keyring_url" "$tmp/diode.gpg" || die "download failed: $keyring_url"
    printf 'deb [signed-by=/etc/apt/keyrings/diode.gpg] %s/latest/download ./\n' "$BASE" > "$tmp/diode.list"

    say "> Adding the Diode apt repository (you may be asked for your password)"
    as_root install -d -m 0755 /etc/apt/keyrings
    as_root install -m 0644 "$tmp/diode.gpg" /etc/apt/keyrings/diode.gpg
    as_root install -m 0644 "$tmp/diode.list" /etc/apt/sources.list.d/diode.list

    # Refresh only our list: a stale third-party repository elsewhere must not
    # block this install, and it is much faster than a full `apt update`.
    say "> apt-get update (Diode repository only)"
    as_root apt-get update \
        -o Dir::Etc::sourcelist=/etc/apt/sources.list.d/diode.list \
        -o Dir::Etc::sourceparts=- \
        -o APT::Get::List-Cleanup=0
    say "> apt-get install diode"
    as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y diode
    say "> Installed /usr/bin/diode: diode $(/usr/bin/diode --version 2>/dev/null || true)"
    say "> Updates: sudo apt update && sudo apt install --only-upgrade diode"
    return 0
}

# --- brew ----------------------------------------------------------------------

install_brew() {
    have brew || die "Homebrew not found: https://brew.sh (or use --method=binary)"
    say "> brew install diode-editor/tap/diode"
    brew install diode-editor/tap/diode
    say "> Updates: brew upgrade diode"
    return 0
}

# --- npm -----------------------------------------------------------------------

install_npm() {
    have npm || die "npm not found (or use --method=binary)"
    say "> npm install -g @diode-editor/diode"
    npm install -g @diode-editor/diode
    say "> Updates: npm update -g @diode-editor/diode"
    return 0
}

# --- dispatch ------------------------------------------------------------------

case "$METHOD" in
    binary) install_binary ;;
    apt)    install_apt ;;
    brew)   install_brew ;;
    npm)    install_npm ;;
    *)      usage; die "unknown method: $METHOD" ;;
esac
