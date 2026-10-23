# Install

Every channel below delivers the same single-file binary from
[GitHub Releases](https://github.com/diode-editor/diode/releases): Linux x64/arm64, macOS
x64/arm64, Windows x64. The Node.js runtime, the TypeScript language server and ripgrep are
inside; nothing else is needed.

## Quick install (Linux, macOS)

```sh
curl -fsSL https://raw.githubusercontent.com/diode-editor/diode/main/install.sh | sh
```

Puts `diode` into `/usr/local/bin` when writable, otherwise into `~/.local/bin`. Run it again to
update. To let a package manager own the install and the updates instead, add
`-s -- --method=apt` (or `brew`, `npm`) after `sh`.

## npm

```sh
npm install -g @diode-editor/diode
npx @diode-editor/diode .          # run without installing
```

Downloads the binary for your platform on install. Works on Windows too.

## Homebrew (macOS, Linux)

```sh
brew install diode-editor/tap/diode
```

## apt (Debian, Ubuntu)

```sh
curl -fsSL https://raw.githubusercontent.com/diode-editor/diode/main/install.sh | sh -s -- --method=apt
```

Adds the Diode repository and installs the package; it asks for your password through `sudo`.
Updates then come with `apt upgrade`. A `.deb` is also attached to each release for a one-off
`dpkg -i`.

## winget (Windows): coming soon

The package is awaiting review in the winget repository. Until then, use npm or the manual
download. The binary is not code-signed: SmartScreen may warn when it is launched from Explorer,
not from a terminal.

## mise

```sh
mise use -g github:diode-editor/diode
```

## Nightly

Built every night from `main` under the tag `nightly`:

```sh
curl -fsSL https://raw.githubusercontent.com/diode-editor/diode/main/install.sh | DIODE_VERSION=nightly sh
```

The assets are at [releases/tag/nightly](https://github.com/diode-editor/diode/releases/tag/nightly).

## Manual

Download the asset for your platform from the
[latest release](https://github.com/diode-editor/diode/releases/latest), `chmod +x` it and put it on
PATH. On macOS a binary downloaded by a browser carries the quarantine attribute
(`xattr -d com.apple.quarantine diode` removes it); `curl` and the channels above do not.

## Pin a version

| channel | |
| --- | --- |
| quick install | `DIODE_VERSION=v0.9.10` in front of `sh` (`DIODE_INSTALL_DIR` picks the directory; `--help` lists the rest) |
| npm | `npm install -g @diode-editor/diode@0.9.10` |
| apt | `sudo apt install --allow-downgrades diode=0.9.10`, then `sudo apt-mark hold diode` to keep it; every release stays installable |
| manual | the asset of that release on GitHub |
