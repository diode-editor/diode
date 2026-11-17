# Status

Diode is in **alpha**: usable every day, with gaps. This page lists what you are most likely to
miss coming from VS Code, what is planned, and what will never come. What works but works
differently is on [Differences from VS Code](DIFFERENCES.md).

## Known gaps

- **Debugging** is in progress. `.diode/launch.json` is read, F5 runs its `preLaunchTask` and starts the
  session with the debugger extension's own adapter; the Run and Debug view and the Debug Console show it,
  extensions see the sessions, their events and breakpoints. Breakpoints in the editor and the debug toolbar
  are not there yet.
- **Snippets** from extensions are not read; **file icon themes** are not applied.
- **Source control extensions.** Built-in git works (diffs, commit graph, staging); an extension
  that brings another version control system has no API to plug into yet.
- **Notebooks, chat and language model APIs** are not exposed to extensions.
- **Very large files.** A file above 20 MB opens read-only at once, whatever the size; editing it
  means **Enable Editing**, which loads the whole file into memory (a few seconds for 500 MB), and a
  file that does not fit in memory stays read-only.
- **Very long lines.** A line of hundreds of thousands of characters is rendered in full and slows
  the editor down.

For the status of each member of the extension API, see the
[readiness matrix](API-COVERAGE.md).

## Planned

No dates promised, in the order that seems right today.

- Long lines without the slowdown.
- `.gitignore` honoured in the file tree, as it already is in search and Quick Open.
- Snippets and file icon themes from extensions.
- More languages in the store: Rust and C# next, then on demand.
- Debugging through the Debug Adapter Protocol, so VS Code debugger extensions work.

## Won't happen

- **Webviews, custom editors and other browser-based UI** from extensions: a terminal can't draw
  them. Extensions with such parts work without them ([what can't work](EXTENSIONS.md#what-cant-work)).
- **A GUI version.** Diode lives in the terminal.
