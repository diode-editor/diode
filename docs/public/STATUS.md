# Status

Diode is in **alpha**: usable every day, with gaps. This page lists what you are most likely to
miss coming from VS Code, what is planned, and what will never come. What works but works
differently is on [Differences from VS Code](DIFFERENCES.md).

## Known gaps

- **Debugging.** There is no debugger yet: no Run and Debug view, no breakpoints, `launch.json` is
  ignored. Extensions that bring a debugger still load, but a debug session never starts.
- **Snippets** from extensions are not read; **file icon themes** are not applied.
- **Tree views from extensions** register and get a section in the sidebar, but the tree itself
  is not drawn yet.
- **Source control extensions.** Built-in git works (diffs, commit graph, staging); an extension
  that brings another version control system has no API to plug into yet.
- **Notebooks, chat and language model APIs** are not exposed to extensions.
- **Very large files.** Tens of megabytes open and edit fine; a file of hundreds of megabytes takes
  long to open and the first edit is slow.
- **Very long lines.** A line of hundreds of thousands of characters is rendered in full and slows
  the editor down.
- **Extensions don't update themselves.** An update is a button on the extension's page
  ([extensions](EXTENSIONS.md)).

For the status of each member of the extension API, see the
[readiness matrix](API-COVERAGE.md).

## Planned

No dates promised, in the order that seems right today.

- Large files that open and edit like small ones, whatever the size, and long lines without the
  slowdown.
- `.gitignore` honoured in the file tree, as it already is in search and Quick Open.
- Snippets, file icon themes and tree views from extensions.
- Automatic extension updates.
- More languages in the store: Rust and C# next, then on demand.
- Debugging through the Debug Adapter Protocol, so VS Code debugger extensions work.

## Won't happen

- **Webviews, custom editors and other browser-based UI** from extensions: a terminal can't draw
  them. Extensions with such parts work without them ([what can't work](EXTENSIONS.md#what-cant-work)).
- **A GUI version.** Diode lives in the terminal.
