# Status

Diode is in **alpha**: usable every day, with gaps. This page lists what you are most likely to
miss coming from VS Code, what is planned, and what will never come. What works but works
differently is on [Differences from VS Code](DIFFERENCES.md).

## Known gaps

- **Debugging** works through debugger extensions: CodeLLDB from the store debugs C and C++ —
  `.diode/launch.json` with its `preLaunchTask` (with completion of the debuggers' attributes and configuration
  snippets, no validation yet), breakpoints in the gutter (F9) with conditions, hit counts, log messages and
  triggers, function, exception and data breakpoints, inline breakpoints (Shift+F9), stepping, Run to Cursor, Jump
  to Cursor, Step Into Target, the exception shown after its line, Variables, Watch, Call Stack, Breakpoints, the
  Debug Console and the debug toolbar. Not there yet: hovering a variable for its value, inline values,
  conditions edited in place (they go through a quick input), the disassembly and memory views.
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
- The rest of debugging: hover and inline values, the breakpoint widget, Node.js through js-debug.

## Won't happen

- **Webviews, custom editors and other browser-based UI** from extensions: a terminal can't draw
  them. Extensions with such parts work without them ([what can't work](EXTENSIONS.md#what-cant-work)).
- **A GUI version.** Diode lives in the terminal.
