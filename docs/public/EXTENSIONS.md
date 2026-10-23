# Extensions

Diode runs VS Code extensions unchanged: the same `.vsix`, the same extension API, in a separate
extension host process. TypeScript and JavaScript are built in; other languages and tools come
from the store, the same way they do in VS Code.

## The store

The store at [diode-editor.github.io/marketplace](https://diode-editor.github.io/marketplace/) is a
**curated** index, not a mirror of Open VSX: every extension in it has been checked to work in a
terminal, and the latest version of each one is smoke-tested on every Diode pull request. The
`.vsix` files stay where their authors publish them (Open VSX or GitHub Releases); the index pins
a URL and a sha256 for every version.

Some extensions carry a **Partial** badge: the extension works, but some of its features need a
browser or a GUI and are listed under "Does not work" on its page, before you install it. A typical
example: the language server works, the extension's webview chat or tree views don't.

What is there today: Python (basedpyright, ruff), ESLint, Prettier, Go (gopls), Java (Eclipse JDT),
Terraform, Protocol Buffers, EditorConfig, `#region` folding, Catppuccin themes, Claude Code with a
diff tab for proposed edits, and Supermaven inline completions.

## Installing from inside the editor

Open the Extensions view with `Ctrl+Shift+X` (or `Ctrl+K X` in a terminal that can't deliver
Ctrl+Shift, see [Keyboard](KEYBOARD.md)); it is also under **View: Show Extensions** in the command
palette. Type in the search box: results come in two groups, **Marketplace** and **Installed**.
`Enter` on a row opens the extension's page with its description, the support note and the
buttons: **Install**, **Update to x.y.z**, **Uninstall**.

After an install or uninstall, run **Reload Window** (File menu or the command palette): extensions
are loaded at startup, there is no hot reload. The catalog is fetched the first time you open the
view; **Extensions: Refresh** reloads it.

Extensions do not update themselves. An update is the same button on the same page. An open window
keeps working with the version it started with: the old files stay on disk and are removed the next
time diode starts. The same goes for an uninstall.

To go back to an older version, press **Install Specific Version...** on the extension page (or run
**Extensions: Install Specific Version of Extension...** from the command palette) and pick one of
the versions that work with your build. A version chosen this way is pinned in the profile, like in
VS Code.

## From the command line

```sh
diode --install-extension charliermarsh.ruff   # by id, from the store
diode --install-extension publisher.name@1.2.3   # exactly this version, pinned
diode --install-extension ./my-extension.vsix  # a local .vsix
diode --uninstall-extension charliermarsh.ruff
diode --list-extensions
diode --disable-extensions .                   # start without user extensions, keep built-ins
```

Ids are case-sensitive: `golang.go`, not `golang.Go`. Installing by id also installs the
extension's dependencies. A `.vsix` from any source installs the same way; whether it works is up to
the API it uses, see below.

## Where they live

Installed extensions go to `~/.diode/extensions` (or `<user-data-dir>/extensions` with
`--user-data-dir`; `--extensions-dir` overrides either). Profiles each keep their own list of
extensions, like VS Code profiles: `--profile <name>` starts with that profile's set.

## What can't work

The ceiling is a terminal: anything that needs a browser is not supported, by design. When an
extension calls `createWebviewPanel` or registers a webview view or custom editor, the call is a
no-op: no panel opens, the rest of the extension keeps working, and one line in **Output →
Extensions** says which call it was. A failed activation of one extension never blocks the others;
the error goes to the **Extension Host** log channel.

Extensions run in their own process. If that process dies, Diode revives the extensions on their
next activation event; **Reload Window** does it immediately.

The exact status of every API member is in the [readiness matrix](API-COVERAGE.md). If an extension
you need misses a feature, that page says whether it is planned or impossible.

## Publishing to the store

An extension gets into the index through a pull request to
[diode-editor/diode-editor.github.io](https://github.com/diode-editor/diode-editor.github.io): one
JSON file per extension under `extensions/`, with a URL and sha256 for each version. Versions are
immutable, pre-releases are rejected, and the bar is that the extension really works in Diode. The
format and the validator are described in that repository.
