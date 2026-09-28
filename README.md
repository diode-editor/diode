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
diode .            # open a folder
diode src/app.ts   # open a file
diode              # empty window — pick a folder from inside
```

`diode -g file.ts:42:7` opens a file with the caret already there, and
`diode -d old.ts new.ts` opens a diff. `diode --help` lists the rest.

## Other ways to install

Every channel delivers the same single-file binary from
[GitHub Releases](https://github.com/diode-editor/diode/releases). Details, knobs and the manual
route: [docs/public/INSTALL.md](docs/public/INSTALL.md).

**npm / npx** (Linux, macOS, Windows)

```sh
npx @diode-editor/diode            # run without installing
npm install -g @diode-editor/diode
```

**Homebrew** (macOS, Linux)

```sh
brew install diode-editor/tap/diode
```

**apt** (Debian, Ubuntu): the same script adds the Diode repository and installs the package, so
updates come through `apt` afterwards

```sh
curl -fsSL https://raw.githubusercontent.com/diode-editor/diode/main/install.sh | sh -s -- --method=apt
```

**winget** (Windows)

```powershell
winget install DiodeEditor.Diode
```

**Nightly** build from `main`, fixed tag `nightly`:

```sh
curl -fsSL https://raw.githubusercontent.com/diode-editor/diode/main/install.sh | DIODE_VERSION=nightly sh
```

## Status

Alpha. Roadmap and what "alpha" means: [docs/public/ROADMAP.md](docs/public/ROADMAP.md).
VS Code extension API coverage: [docs/public/API-COVERAGE.md](docs/public/API-COVERAGE.md).

## License

GPL-3.0-or-later, see [LICENSE](LICENSE). Vendored code keeps its own license, see
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
