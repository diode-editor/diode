# File open benchmark

- Recorded: 2026-10-21T23:27:39.103Z, commit `84cdfccd90b6`, diode nightly-84cdfcc
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 26 ms; binary floor (`diode --version` over PTY, median): 58 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **130 ms** | 98 ms | 156 ms | 267 ms | 11 ms | 244 MB | 11 |
| `medium` | 126.7 KB | 2000 | **173 ms** | 141 ms | 199 ms | 317 ms | 16 ms | 260 MB | 11 |
| `large` | 1.3 MB | 20000 | **322 ms** | 290 ms | 348 ms | 453 ms | 26 ms | 300 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **1535 ms** | 1503 ms | 1561 ms | 1744 ms | 58 ms | 500 MB | 5 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` |
| --- | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 7 ms | 13 ms |
| node ready (bootstrapComplete) | 61 ms | 65 ms | 67 ms | 84 ms |
| bundle executed (main:start) | 61 ms | 65 ms | 67 ms | 84 ms |
| config loaded | 81 ms | 84 ms | 81 ms | 112 ms |
| keybindings loaded | 81 ms | 85 ms | 82 ms | 113 ms |
| session state loaded | 81 ms | 85 ms | 82 ms | 113 ms |
| extensions scanned | 76 ms | 81 ms | 78 ms | 107 ms |
| themes ready | 84 ms | 89 ms | 85 ms | 117 ms |
| DI container created | 88 ms | 93 ms | 89 ms | 121 ms |
| workbench mounted | 115 ms | 124 ms | 120 ms | 149 ms |
| first frame | 115 ms | 124 ms | 120 ms | 149 ms |
| workbench activated | 120 ms | 130 ms | 125 ms | 153 ms |
| grammars preloaded | 130 ms | 139 ms | 135 ms | 158 ms |
| file read from disk | 131 ms | 141 ms | 146 ms | 250 ms |
| file decoded | 131 ms | 141 ms | 146 ms | 250 ms |
| document built | 131 ms | 141 ms | 146 ms | 250 ms |
| tokenizer attached to editor | 154 ms | 198 ms | 350 ms | 1562 ms |
| tabs opened | 136 ms | 152 ms | 165 ms | 292 ms |
| built-in extensions registered | 287 ms | 338 ms | 472 ms | 1763 ms |
| frame with file text | 154 ms | 196 ms | 347 ms | 1560 ms |
| frame with highlighting | 267 ms | 317 ms | 453 ms | 1744 ms |
| extension host up | 526 ms | 587 ms | 732 ms | 2322 ms |
| startup complete | 282 ms | 332 ms | 467 ms | 1758 ms |
| to text (black box) | 156 ms | 199 ms | 348 ms | 1561 ms |
| to highlight (black box) | 267 ms | 317 ms | 453 ms | 1744 ms |
| gap black − white (text) | 1 ms | 2 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 36 ms | 14 ms | 12 ms | 10 ms | 17 ms | 6 ms | 4 ms |
| `medium` | 39 ms | 18 ms | 14 ms | 13 ms | 17 ms | 5 ms | 7 ms |
| `large` | 71 ms | 52 ms | 44 ms | 58 ms | 51 ms | 12 ms | 11 ms |
| `xlarge` | 236 ms | 466 ms | 400 ms | 334 ms | 255 ms | 12 ms | 66 ms |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
