# Install

Every channel below delivers the same single-file binary from
[GitHub Releases](https://github.com/diode-editor/diode/releases): Linux x64/arm64, macOS
x64/arm64, Windows x64. The Node.js runtime, the TypeScript language server and ripgrep are inside.

## Quick install (Linux, macOS)

```sh
curl -fsSL https://raw.githubusercontent.com/diode-editor/diode/main/install.sh | sh
```

Puts `diode` into `/usr/local/bin` when writable, otherwise into `~/.local/bin`. Knobs:
`DIODE_VERSION=v0.3.0` (or `nightly`) picks a release, `DIODE_INSTALL_DIR` picks the directory.
Checksums are verified against the `.sha256` sidecar published with each release. To update,
run the script again.

The same script can hand the install to a package manager, which then owns updates:
`--method=apt` (Debian/Ubuntu, see below), `--method=brew`, `--method=npm`. Pass it as
`sh -s -- --method=apt` after the pipe, or set `DIODE_INSTALL_METHOD`. `--help` lists them.

## npm / npx

```sh
npx @diode-editor/diode            # run without installing
npm install -g @diode-editor/diode
```

Thin wrapper: on install it downloads the binary for your platform from the release with the same
version and verifies its sha256. Works on Windows too.

## Homebrew (macOS, Linux)

```sh
brew install diode-editor/tap/diode
```

It is a cask that links the release binary into `$(brew --prefix)/bin`; no compiler or Command
Line Tools are needed.

## apt (Debian, Ubuntu)

One line: the installer adds the repository (keyring plus a `sources.list.d` entry), refreshes only
that list and installs the package. It asks for your password through `sudo`. Updates then come
through `apt` as for any other package.

```sh
curl -fsSL https://raw.githubusercontent.com/diode-editor/diode/main/install.sh | sh -s -- --method=apt
```

The repository is flat and lives on GitHub Releases, so it always serves the latest stable
version (nightly is a pre-release and never lands here). The same by hand:

```sh
sudo install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://github.com/diode-editor/diode/releases/latest/download/diode-archive-keyring.gpg \
  | sudo tee /etc/apt/keyrings/diode.gpg >/dev/null
echo "deb [signed-by=/etc/apt/keyrings/diode.gpg] https://github.com/diode-editor/diode/releases/latest/download ./" \
  | sudo tee /etc/apt/sources.list.d/diode.list
sudo apt update && sudo apt install diode
```

The `.deb` files themselves are also attached to each release for a one-off `dpkg -i`.

## winget (Windows)

```powershell
winget install DiodeEditor.Diode
```

The binary is not code-signed. Windows Defender SmartScreen may warn when the `.exe` is launched
from Explorer; launching `diode` from a terminal does not trigger it.

## mise

The release assets follow the naming `mise`/`ubi` understand, so no extra setup is needed:

```sh
mise use -g github:diode-editor/diode
```

## Nightly

Built every night from `main` under the fixed tag `nightly`:

```sh
curl -fsSL https://raw.githubusercontent.com/diode-editor/diode/main/install.sh | DIODE_VERSION=nightly sh
```

or download an asset directly from
[releases/tag/nightly](https://github.com/diode-editor/diode/releases/tag/nightly).

## Manual

Download the asset for your platform from the
[latest release](https://github.com/diode-editor/diode/releases/latest), `chmod +x` it and put it on
PATH. On macOS a binary downloaded by a browser carries the quarantine attribute; `curl` and the
channels above do not.
