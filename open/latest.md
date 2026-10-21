# File open benchmark

- Recorded: 2026-10-21T21:21:25.328Z, commit `f2d0113737b4`, diode nightly-f2d0113
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 24 ms; binary floor (`diode --version` over PTY, median): 57 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **138 ms** | 104 ms | 161 ms | 279 ms | 14 ms | 246 MB | 11 |
| `medium` | 126.7 KB | 2000 | **173 ms** | 140 ms | 197 ms | 317 ms | 9 ms | 249 MB | 11 |
| `large` | 1.3 MB | 20000 | **326 ms** | 292 ms | 349 ms | 458 ms | 16 ms | 300 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **1631 ms** | 1597 ms | 1654 ms | 1836 ms | 159 ms | 504 MB | 5 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` |
| --- | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 7 ms | 10 ms |
| node ready (bootstrapComplete) | 63 ms | 64 ms | 69 ms | 88 ms |
| bundle executed (main:start) | 63 ms | 64 ms | 69 ms | 88 ms |
| config loaded | 84 ms | 80 ms | 84 ms | 112 ms |
| keybindings loaded | 85 ms | 81 ms | 84 ms | 112 ms |
| session state loaded | 85 ms | 81 ms | 84 ms | 112 ms |
| extensions scanned | 78 ms | 77 ms | 81 ms | 108 ms |
| themes ready | 88 ms | 85 ms | 89 ms | 115 ms |
| DI container created | 91 ms | 89 ms | 93 ms | 119 ms |
| workbench mounted | 121 ms | 121 ms | 125 ms | 146 ms |
| first frame | 121 ms | 121 ms | 125 ms | 146 ms |
| workbench activated | 126 ms | 127 ms | 130 ms | 151 ms |
| grammars preloaded | 136 ms | 135 ms | 136 ms | 157 ms |
| file read from disk | 137 ms | 137 ms | 150 ms | 243 ms |
| file decoded | 137 ms | 137 ms | 150 ms | 243 ms |
| document built | 137 ms | 137 ms | 150 ms | 243 ms |
| tokenizer attached to editor | 161 ms | 197 ms | 351 ms | 1656 ms |
| tabs opened | 142 ms | 148 ms | 169 ms | 284 ms |
| built-in extensions registered | 304 ms | 338 ms | 477 ms | 1855 ms |
| frame with file text | 160 ms | 195 ms | 349 ms | 1654 ms |
| frame with highlighting | 279 ms | 317 ms | 458 ms | 1836 ms |
| extension host up | 525 ms | 584 ms | 746 ms | 2419 ms |
| startup complete | 298 ms | 332 ms | 473 ms | 1850 ms |
| to text (black box) | 161 ms | 197 ms | 349 ms | 1654 ms |
| to highlight (black box) | 279 ms | 317 ms | 458 ms | 1836 ms |
| gap black − white (text) | 2 ms | 2 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 44 ms | 14 ms | 13 ms | 13 ms | 16 ms | 6 ms | 6 ms |
| `medium` | 42 ms | 14 ms | 13 ms | 14 ms | 16 ms | 7 ms | 9 ms |
| `large` | 88 ms | 57 ms | 40 ms | 43 ms | 58 ms | 13 ms | 15 ms |
| `xlarge` | 240 ms | 368 ms | 393 ms | 326 ms | 259 ms | 11 ms | 72 ms |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
