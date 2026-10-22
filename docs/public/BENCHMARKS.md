# Benchmarks: startup speed

> **Draft.** The page structure is ready, but the comparison table has not yet been taken with the
> methodology below. Before publishing we will take it in a single run and remove this notice.

Diode is written in TypeScript and runs on Node.js, which for a terminal editor is usually taken as
a death sentence for speed. This page exists so that the argument is about numbers, not feelings.
Every number here is reproducible with the methodology at the bottom and guarded by a perf test in CI.

## Startup ladder

Startup is not one number but a ladder. Nothing slow stands on the path to the first frame with
text (VS Code itself is built the same way): the extension host starts after that frame,
highlighting arrives in the next frame, and the language server comes asynchronously, later still.

The headline number is **"our ms"**: time to the frame with text minus the Node floor (`node -e ""`,
launched the same way). It is the cost of Diode itself on top of the runtime. The median on CI (a
GitHub Actions shared runner, a 100-line file) is **≈100 ms of ours** (calibrated 2026-10-16); on the
author's 4-core laptop it is ≈175. CI takes the live numbers and the full ladder of marks on every
push to `main`: [methodology and data](BENCH-OPEN.md), [chart](https://diode-editor.github.io/benchmarks/).

The previous version of this page promised "26 ms of workbench". That is wrong: back then the floor
was `node --version`, and a modern node answers it before V8 starts up.

## Comparison with other editors

All measurements: one machine, one day, one methodology (see below). The configurations are real,
not showcase ones: nobody runs bare nvim, so the table has a row with a distribution.

| editor | configuration | startup to ready | note |
| --- | --- | ---: | --- |
| vim | bare | _TBD_ | |
| neovim | bare | _TBD_ | |
| neovim | LazyVim / NvChad | _TBD_ | real setup with LSP |
| helix | out of the box | _TBD_ | |
| diode | out of the box | _TBD_ | |

We will lose to bare vim: a native binary against a runtime, and that is fair. The interesting row is
a configured neovim with LSP: that is what people actually use.

## Methodology

_To be filled in when the numbers are taken in a single run:_

- **Hardware and conditions:** CPU model, power mode (Balanced), on battery or on AC, OS.
- **What counts as startup:** for Diode, the marks of the ladder (instrumented in the code); for the
  others, until ready to accept input (describe how this is captured for each editor).
- **How it was measured:** N runs, median; warm/cold cache; the exact launch command for each
  editor, as a list, so anyone can repeat it.

## Guarding the numbers

A number we boast about must be guarded by a test. The perf gate `e2e/bench/startupBudget.bench.ts`
(`npm run test:perf`) keeps the median of "our ms" on a small file within budget, currently 200 ms.
The budget is a ratchet: it goes down as optimizations land and is relaxed only with a measurement.
