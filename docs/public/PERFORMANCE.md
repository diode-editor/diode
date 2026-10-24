# Performance

Diode is a TypeScript program on Node.js, and it is fast where it matters: it starts in a fraction
of a second, typing never waits for highlighting or a language server, and a large file doesn't
freeze the editor. Every number on this page is taken by CI on every push, and the live values with
their history are on the [benchmarks chart](https://diode-editor.github.io/benchmarks/).

## Startup

From the command to the first frame with your file's text, Diode's own work takes **about 100 ms**
on a GitHub Actions runner and about 175 ms on a 4-core laptop. That is on top of the Node.js
runtime's own start, which is subtracted so that the number measures Diode and not the machine;
the chart shows both. Nothing slow stands on the path to that frame: highlighting arrives in the
next frame, the extension host starts after it, and the language server comes later still.

## Large files

A 13 MB TypeScript file of 200,000 lines shows its text within 350 ms of Diode's own time, and once
background highlighting has settled, Enter and undo in the middle of it take under 20 ms. The
document is VS Code's PieceTree and tokenization runs by viewport, so jumping to the end of the
file doesn't wait for anything.

## Giant files

Above 20 MB or 300,000 lines a file opens read-only straight from disk, the way VS Code turns its
heavy features off for a large file: the first screen is read at once and the rest is indexed in
the background. A 500 MB log of 5.3 million lines shows its text in about 145 ms of Diode's own
time — the same as a 100-line file — the index is done in about a second, and the editor stays
under 300 MB of memory. While the index runs, keys keep answering. Find walks the file in the
background: a match in the middle of the 500 MB log shows in under two seconds, and typing in the
find box stays under 20 ms while the walk goes on. A log that is being written follows its tail
on screen when the cursor is on the last line. **Enable Editing** in the notification streams the
file into memory with a progress counter, and the editor answers keys during the load.

## How it is measured

The real release binary is launched in a 120×32 pseudo-terminal in a hermetic environment (its
own home and user-data directory). Timing starts at process spawn; the moments when text and
highlighting appear are recovered from the timestamps of the output. The matrix runs from 100 to
200,000 lines, plus the 500 MB log; after the open, a character is inserted in the middle of the file, Enter, undo,
`Ctrl+End` and a word search are timed from the keystroke to the frame where the change is
visible; peak memory is recorded for the whole run. Each size runs several times, the first run is
a warm-up, and the median is reported with its spread.

The budgets are tests in CI: startup, the large-file and the giant-file numbers above fail the
build when they regress, and the budgets only go down as optimizations land. How to run the benchmarks from a
checkout is in the repository's developer documentation.

## Other editors

A comparison with vim, neovim (bare and with a distribution) and helix is planned: one machine,
one day, one methodology, with the exact launch command for each editor so that anyone can repeat
it. Until it is taken in a single run, this page has no numbers for other editors.
