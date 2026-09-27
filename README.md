# Diode

Terminal text editor with the VS Code keyboard layout, VS Code language extensions and LSP.
Non-modal. Runs where VS Code does not: over ssh, in containers, on a Raspberry Pi.

## Quick install

```sh
curl -fsSL https://raw.githubusercontent.com/diode-editor/diode/main/install.sh | sh
```

The script detects your OS and CPU (Linux and macOS, x64 and arm64), downloads a single-file
binary from the latest release, verifies its checksum and puts `diode` on your PATH. No package
manager involved. Then:

```sh
diode .
```

Other channels (apt, Homebrew, npm, winget) and the nightly build are listed in
[docs/public/INSTALL.md](docs/public/INSTALL.md).

## Status

Alpha. Roadmap and what "alpha" means: [docs/public/ROADMAP.md](docs/public/ROADMAP.md).
VS Code extension API coverage: [docs/public/API-COVERAGE.md](docs/public/API-COVERAGE.md).

## License

GPL-3.0-or-later, see [LICENSE](LICENSE). Vendored code keeps its own license, see
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
