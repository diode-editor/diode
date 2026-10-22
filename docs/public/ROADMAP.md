# Roadmap

Diode is in **alpha**: you can use it every day, but the extension API surface and the tool set
are still growing. This page says what works today, what doesn't yet, and what will never come.

## Goal

Full support for the VS Code extension API wherever it makes sense in a terminal. Language and
tooling extensions: yes. Webview surfaces will not be supported: they need a browser.
Measurable progress is in the [readiness matrix](API-COVERAGE.md).

## What works today

- **One-command install**: `curl | sh`, apt, npm, Homebrew, winget, with single-binary builds
  for Linux, macOS and Windows ([install](INSTALL.md)).
- **The editor**: non-modal, VS Code keybindings, multiple cursors, mouse, VS Code's PieceTree
  document, background tokenization by viewport. Typing doesn't wait for highlighting, and jumping
  to the end of a large file doesn't freeze the editor.
- **Languages**: TypeScript/JavaScript are built in. In the store: Python (basedpyright, ruff),
  ESLint, Prettier, Java, Go, Terraform, EditorConfig, themes (Catppuccin) and Claude Code with a
  diff tab for proposed edits ([extensions](EXTENSIONS.md)).
- **Extensions**: themes, semantic tokens, language configuration, settings, tasks, terminals,
  source control, profiles with their own set of extensions.
- **Built-in tools**: file tree, project-wide search, git with diffs and a commit graph, integrated
  terminal, Problems panel.
- **Fast startup, guarded by a test**: a startup perf threshold in CI ([performance](PERFORMANCE.md)).

## What doesn't work yet

The gaps you are most likely to hit. All of them are on the list below; none is forgotten.

- **Debugging**: no Debug Adapter Protocol yet; `vscode.debug` is a null object.
- **Snippets and file icon themes** from extensions are not read yet; **TreeView** from extensions
  registers but is not drawn.
- **Very large files**: a file of hundreds of megabytes takes long to open and the first edit is
  slow; tens of megabytes work.
- **Very long lines**: a line of hundreds of thousands of characters is rendered in full.
- **`vscode.scm`, `vscode.notebooks`, `vscode.chat`, `vscode.lm`**: namespaces not exposed yet.

## Next up

The first release is tied to a single frame: a terminal that looks and behaves like VS Code:
theme, highlighting, a live language server, completion. Everything below is needed to make that
frame true on any file and on any machine.

- **Honest numbers.** A vim · neovim · neovim+distribution · helix · diode table, taken in a single
  run following the published methodology ([performance](PERFORMANCE.md)).
- **Even faster startup.** The remaining levers in the startup path.
- **Large files without pauses.** A file of tens of megabytes opens like a small one, and the cost
  of a keystroke doesn't depend on the file size.

## Later

No dates promised, in the order that seems right today.

- **Growing the extension API surface** along the [readiness matrix](API-COVERAGE.md): file icons,
  snippets, views (TreeView from extensions), the rest of language configuration.
- **Very large files**: streaming reads and a "large file" mode for hundreds of megabytes.
- **Long lines and large file trees**: a lazy window over the visible columns,
  `editor.stopRenderingLineAfter`, `.gitignore` in the tree, a native watcher.
- **More languages in the store**: Rust, C#, then on demand.
- **Partial frame redraw** (damage tracking) for overlays and hover: a saving on every frame
  that the user doesn't see but feels on a slow connection.
- **An editor for agents**: an MCP server on top of the extension host, so the agent gets a
  language server as a tool rather than regex.
- **Debugging** through the Debug Adapter Protocol.

## Won't happen

- Webview and UI-heavy extensions: that is the ceiling of a terminal, by design.
- A GUI version: Diode lives in the terminal.
