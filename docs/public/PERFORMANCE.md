# Performance

Diode is written in TypeScript and runs on Node.js, which for a terminal editor is usually taken as
a death sentence for speed. This page exists so that the argument is about numbers, not feelings:
every number is taken by CI with the methodology below, and the startup budget is guarded by a test.

## The headline number

Startup is measured as **"our ms"**: time from process spawn to the first frame with the file's text,
minus the Node floor (`node -e ""` launched the same way). It is the cost of Diode itself on top of
the runtime. On a GitHub Actions runner with a 100-line file the median is **about 100 ms of ours**;
on a 4-core laptop about 175. The language server and the extension host start after that frame and
never stand on the path to it.

The live numbers, the full ladder of marks and the history by week are on the
[benchmarks chart](https://diode-editor.github.io/benchmarks/). Nothing there is written by hand: on
every push to `main` the CI job [`bench.yml`](../../.github/workflows/bench.yml) runs
`npm run bench:open` on the built binary and commits the result to the data branch
[`bench-data`](https://github.com/diode-editor/diode/tree/bench-data/open).

## What is measured

The real binary is launched in a 120×32 PTY in a hermetic environment (its own user-data-dir and
HOME). Timing starts at process spawn; the moments when text and highlighting appear are recovered
from the timestamps of stdout chunks. The matrix runs from 100 lines to 200,000 lines (13 MB) of
TypeScript. LSP is not part of the measurement: it ends at TextMate highlighting.

- **Our ms**: time to text minus the node floor. `node --version` can't serve as the floor: a modern
  node answers it before V8 starts up.
- **Above the binary floor**: minus `diode --version`; this also removes parsing the single-file
  bundle, leaving the workbench's own startup work.
- **To text / to highlighting**: from spawn to the frame with the file's text and to the frame where
  a keyword is colored by the theme.
- **Ladder of marks**: white box, `performance.mark` inside the process (`DIODE_STARTUP_TRACE`),
  from process start through config, workbench, file read and document to the frame with text and
  the extension host start; the discrepancy with the black box is printed next to it.
- **Keystroke latency** after open: inserting a character in the middle of the file, Enter, undo,
  `Ctrl+End`, word search; from the write to the PTY to the frame where the change is visible.
- **Peak RSS**: `VmHWM` of the editor process over the whole run.
- **Noise**: median and IQR across runs; a row is marked "noisy" when IQR > 20 % of the median.
  The first run of each size is a warm-up and is not counted.

## Startup ladder

Startup is not one number but a ladder, and nothing slow stands on the path to the first frame with
text (VS Code itself is built the same way): the extension host starts after that frame,
highlighting arrives in the next frame, and the language server comes asynchronously, later still.
Typing never waits for highlighting, and jumping to the end of a large file doesn't freeze the
editor: the document is VS Code's PieceTree, tokenization runs in the background by viewport.

## Other editors

A comparison with vim, neovim (bare and with a distribution), and helix is planned: one machine, one
day, one methodology, with the exact launch command for each editor so anyone can repeat it. We will
lose to bare vim, a native binary against a runtime, and that is fair. The interesting row is a
configured neovim with LSP: that is what people actually use. The table will appear here once it is
taken in a single run; until then this page has no numbers for other editors on purpose.

## Guarding the numbers

A number we boast about must be guarded by a test. The perf gate `e2e/bench/startupBudget.bench.ts`
(`npm run test:perf`) keeps the median of "our ms" on a small file within budget, currently 200 ms.
A second gate, `e2e/bench/xlargeBudget.bench.ts`, does the same for a 13 MB file: "our ms" to text
within 350 ms, and Enter/undo once the background tokenization has settled within 20/16 ms.
The budgets are a ratchet: they go down as optimizations land and are relaxed only with a measurement.

Local run from a checkout: `npm run bench:open -- --sizes=small,medium,xlarge --runs=5 --label="conditions"`.
