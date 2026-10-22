# Roadmap

Diode is in **alpha**. You can already use it, but the API surface and the tool set are still growing.
This page covers where we are going and in what order.

## Goal

Full support for the VS Code extension API wherever it makes sense in a terminal. Language and
tooling extensions: yes. Webview surfaces will not be supported: they need a browser.
Measurable progress is in the [readiness matrix](API-COVERAGE.md).

## Already there

- **One-command install**: `curl | sh`, apt, npm, Homebrew, with single-binary builds
  for Linux, macOS and Windows ([install](INSTALL.md)); winget is in review.
- **Fast startup, guarded by a test**: a startup perf threshold in CI ([benchmarks](BENCHMARKS.md)).
- **A PieceTree document from VS Code**, background tokenization by viewport, binary tokens: typing
  doesn't wait for highlighting, and jumping to the end of a large file doesn't freeze the editor.
- **Languages**: TypeScript/JavaScript are built in. In the marketplace: Python (basedpyright, ruff),
  ESLint, Prettier, Java, Go, Terraform, EditorConfig, themes (Catppuccin) and Claude Code with a
  diff tab for proposed edits.
- **Extensions**: themes, semantic tokens, language configuration, settings, tasks, terminals,
  source control, profiles with their own set of extensions.

## Next up

The first release is tied to a single frame: a terminal that looks and behaves like VS Code:
theme, highlighting, a live language server, completion. Everything below is needed to make that
frame true on any file and on any machine.

- **Honest numbers.** A vim · neovim · neovim+distribution · helix · diode table, taken in a single
  run following the published methodology ([benchmarks](BENCHMARKS.md)).
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
- **More languages in the marketplace**: Rust, C#, then on demand.
- **Partial frame redraw** (damage tracking) for overlays and hover: a saving on every frame
  that the user doesn't see but feels on a slow connection.
- **An editor for agents**: an MCP server on top of the extension host, so the agent gets a
  language server as a tool rather than regex.
- **Debugging** through the Debug Adapter Protocol.

## Won't happen

- Webview and UI-heavy extensions: that is the ceiling of a terminal, by design.
- A GUI version: Diode lives in the terminal.
