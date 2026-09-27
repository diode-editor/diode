# Third-party notices

Diode is licensed under the GNU General Public License v3.0 or later (see [LICENSE](LICENSE)).
The repository also carries code and assets taken verbatim from other projects. They keep their
own licenses, listed here.

## microsoft/vscode (MIT)

Pinned to the tag recorded in `extensions/VSCODE_VERSION`. Imported by the scripts in `scripts/`
(`import-vscode-diff.mjs`, `import-vscode-dts.mjs`, `import-vscode-extensions.mjs`,
`import-vscode-themes.mjs`); files carry the `Copyright (c) Microsoft Corporation` header or the
`//@diode:vendored` marker.

- `src/vs/editor/common/diff/**`, parts of `src/vs/editor/common/core/**`,
  `src/vs/base/common/charCode.ts` — the diff engine.
- `src/vscode-dts/vscode.d.ts` — the extension API surface.
- `extensions/*` — language-basics extensions (grammars, language configurations, snippets); each
  keeps its `package.json` license field and, where upstream ships one, its own license file
  (for example `extensions/latex/*-license.txt`).
- `src/vs/workbench/services/themes/common/themes/*` — built-in color themes.

```
MIT License

Copyright (c) Microsoft Corporation. All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Bundled into the binary

The release binaries embed these components; their licenses travel with the binary.

- Node.js runtime — MIT and the licenses listed in Node's own `LICENSE`.
- ripgrep (`@vscode/ripgrep`) — MIT / Unlicense.
- node-pty — MIT.
- vscode-textmate, vscode-oniguruma (Oniguruma — BSD-2-Clause), vscode-uri, jsonc-parser — MIT.
- TypeScript and typescript-language-server — Apache-2.0 / MIT.
- `@tuidom/*` — MIT.
- `e2e/fonts/` (JetBrains Mono) — OFL-1.1, see `e2e/fonts/LICENSE.md` (test assets only, not shipped).
