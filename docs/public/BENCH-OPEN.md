# File open benchmark

The numbers don't live here: on every push to `main` they are taken by the CI job
[`bench.yml`](../../.github/workflows/bench.yml) (`npm run bench:open` on the built SEA binary,
a GitHub Actions shared runner) and put into the data branch
[`bench-data`](https://github.com/diode-editor/diode/tree/bench-data/open):
the raw JSON of each run, `latest.json`/`latest.md` and an index. The site page
[diode-editor.github.io/benchmarks](https://diode-editor.github.io/benchmarks/) reads that branch and
shows the latest run and the history by week. Numbers are not written by hand, neither here nor there.

## What is measured

The real binary is launched in a 120×32 PTY in a hermetic environment (its own user-data-dir and
HOME). Timing starts at process spawn; the moments when text and highlighting appear are recovered
from the timestamps of stdout chunks. The matrix runs from 100 lines to 200,000 lines (13 MB) of
TypeScript; a half-gigabyte plaintext log will return to the matrix together with streaming (today it
takes a minute and a half to open and dies on the first edit). LSP is not part of the measurement:
it ends at TextMate highlighting.

- **Our ms**: the headline number, time to text minus the node floor. The floor is `node -e ""`,
  spawned the same way (PTY), that is, the minimal process that executes JS at all. `node --version`
  can't serve as the floor: a modern node answers it before V8 starts up; it is printed for reference.
- **Above the binary floor**: minus `diode --version`; this also removes parsing the SEA bundle,
  leaving the workbench's own startup work.
- **To text / to highlighting**: from spawn to the frame with the file's text and to the frame where
  a keyword is colored by the theme.
- **Ladder of marks**: white box, `performance.mark` inside the process (`DIODE_STARTUP_TRACE`),
  from process start through config, workbench, file read and document to the frame with text and
  the extension host start; the discrepancy with the black box is printed next to it.
- **Keystroke latency** after open: inserting a character in the middle of the file, Enter, undo,
  `Ctrl+End`, word search; from the write to the PTY to the frame where the change is visible.
- **Peak RSS**: `VmHWM` of the editor process over the whole run.
- **Noise**: median and IQR across runs; a row is marked "noisy" when IQR > 20 % of the median.
  The first run of each size is a warm-up and is not counted in the statistics.

## Guarding the numbers

The startup budget is locked by the perf gate `e2e/bench/startupBudget.bench.ts` (`npm run test:perf`):
the median of "our ms" on `small` is no higher than `STARTUP_BUDGET_OURS_MS`. The budget is a ratchet:
it goes down as optimizations land and is relaxed only with a measurement. The work plan is in
[docs/TODO/OpenPerformance.md](../TODO/OpenPerformance.md).

Local run: `npm run bench:open -- --sizes=small,medium,xlarge --runs=5 --label="conditions"`;
the script `scripts/bench-publish.mjs` can put it into the same data branch next to the CI runs.
