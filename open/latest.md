# File open benchmark

- Recorded: 2026-10-22T07:03:34.215Z, commit `de273ea867fb`, diode nightly-de273ea
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 27 ms; binary floor (`diode --version` over PTY, median): 63 ms; for reference `node --version`: 5 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **146 ms** | 110 ms | 173 ms | 295 ms | 10 ms | 243 MB | 11 |
| `medium` | 126.7 KB | 2000 | **181 ms** | 145 ms | 208 ms | 336 ms | 10 ms | 260 MB | 11 |
| `large` | 1.3 MB | 20000 | **338 ms** | 302 ms | 365 ms | 477 ms | 9 ms | 300 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **1615 ms** | 1579 ms | 1642 ms | 1835 ms | 30 ms | 498 MB | 5 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` |
| --- | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 8 ms | 7 ms | 10 ms |
| node ready (bootstrapComplete) | 68 ms | 71 ms | 74 ms | 91 ms |
| bundle executed (main:start) | 68 ms | 71 ms | 74 ms | 91 ms |
| config loaded | 88 ms | 92 ms | 92 ms | 113 ms |
| keybindings loaded | 88 ms | 92 ms | 92 ms | 113 ms |
| session state loaded | 88 ms | 93 ms | 93 ms | 113 ms |
| extensions scanned | 84 ms | 87 ms | 88 ms | 108 ms |
| themes ready | 93 ms | 96 ms | 98 ms | 117 ms |
| DI container created | 99 ms | 101 ms | 103 ms | 123 ms |
| workbench mounted | 131 ms | 131 ms | 136 ms | 157 ms |
| first frame | 131 ms | 131 ms | 136 ms | 157 ms |
| workbench activated | 140 ms | 140 ms | 145 ms | 165 ms |
| grammars preloaded | 147 ms | 146 ms | 151 ms | 171 ms |
| file read from disk | 148 ms | 149 ms | 163 ms | 268 ms |
| file decoded | 148 ms | 149 ms | 163 ms | 268 ms |
| document built | 149 ms | 149 ms | 163 ms | 268 ms |
| tokenizer attached to editor | 173 ms | 207 ms | 366 ms | 1644 ms |
| tabs opened | 153 ms | 161 ms | 184 ms | 310 ms |
| built-in extensions registered | 316 ms | 356 ms | 496 ms | 1855 ms |
| frame with file text | 173 ms | 205 ms | 364 ms | 1642 ms |
| frame with highlighting | 295 ms | 336 ms | 476 ms | 1835 ms |
| extension host up | 574 ms | 613 ms | 801 ms | 2454 ms |
| startup complete | 311 ms | 351 ms | 491 ms | 1850 ms |
| to text (black box) | 173 ms | 208 ms | 365 ms | 1642 ms |
| to highlight (black box) | 295 ms | 336 ms | 477 ms | 1835 ms |
| gap black − white (text) | 1 ms | 2 ms | 0 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 45 ms | 16 ms | 13 ms | 12 ms | 17 ms | 9 ms | 9 ms |
| `medium` | 43 ms | 20 ms | 15 ms | 14 ms | 16 ms | 7 ms | 6 ms |
| `large` | 73 ms | 60 ms | 46 ms | 54 ms | 53 ms | 17 ms | 15 ms |
| `xlarge` | 235 ms | 414 ms | 364 ms | 394 ms | 234 ms | 12 ms | 74 ms |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
