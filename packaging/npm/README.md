# @diode-editor/diode

Diode is a terminal text editor with the VS Code keyboard layout, VS Code language extensions and
LSP, running where VS Code does not: over ssh, in containers, on a Raspberry Pi.

```sh
npx @diode-editor/diode            # try it without installing
npm install -g @diode-editor/diode # or keep it
diode .
```

This package is a thin wrapper. On install (or first run) it downloads the single-file binary for
your platform from the matching GitHub release and verifies its sha256. Linux x64/arm64, macOS
x64/arm64 and Windows x64 are supported.

Other ways to install, the source and the issue tracker: https://github.com/diode-editor/diode
