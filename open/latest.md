# File open benchmark

- Recorded: 2026-11-01T20:34:03.724Z, commit `030f487cd788`, diode nightly-030f487
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 62 ms; for reference `node --version`: 5 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **137 ms** | 100 ms | 162 ms | 281 ms | 9 ms | 272 MB | 11 |
| `medium` | 126.7 KB | 2000 | **142 ms** | 105 ms | 167 ms | 285 ms | 8 ms | 280 MB | 11 |
| `large` | 1.3 MB | 20000 | **156 ms** | 119 ms | 181 ms | 316 ms | 7 ms | 292 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **248 ms** | 210 ms | 273 ms | 398 ms | 8 ms | 368 MB | 5 |
| `log500m` | 497 MB | 5295839 | **153 ms** | 116 ms | 178 ms | — (plaintext) | 5 ms | 303 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 6 ms | 7 ms | 9 ms | 6 ms |
| node ready (bootstrapComplete) | 67 ms | 67 ms | 71 ms | 80 ms | 65 ms |
| bundle executed (main:start) | 67 ms | 67 ms | 71 ms | 81 ms | 65 ms |
| config loaded | 87 ms | 85 ms | 92 ms | 105 ms | 86 ms |
| keybindings loaded | 88 ms | 87 ms | 93 ms | 105 ms | 87 ms |
| session state loaded | 88 ms | 87 ms | 93 ms | 105 ms | 88 ms |
| extensions scanned | 82 ms | 81 ms | 88 ms | 102 ms | 80 ms |
| themes ready | 91 ms | 90 ms | 96 ms | 108 ms | 90 ms |
| DI container created | 95 ms | 94 ms | 99 ms | 112 ms | 94 ms |
| workbench mounted | 126 ms | 126 ms | 130 ms | 141 ms | 124 ms |
| first frame | 126 ms | 126 ms | 130 ms | 141 ms | 124 ms |
| workbench activated | 131 ms | 132 ms | 135 ms | 146 ms | 130 ms |
| grammars preloaded | 137 ms | 138 ms | 141 ms | 153 ms | 132 ms |
| file read from disk | 140 ms | 142 ms | 154 ms | 247 ms | 146 ms |
| file decoded | 140 ms | 142 ms | 154 ms | 247 ms | 146 ms |
| document built | 140 ms | 143 ms | 154 ms | 247 ms | 146 ms |
| tokenizer attached to editor | 163 ms | 172 ms | 197 ms | 290 ms | — |
| tabs opened | 146 ms | 149 ms | 165 ms | 259 ms | 164 ms |
| built-in extensions registered | 306 ms | 310 ms | 339 ms | 421 ms | 223 ms |
| frame with file text | 161 ms | 165 ms | 180 ms | 273 ms | 178 ms |
| frame with highlighting | 281 ms | 284 ms | 316 ms | 398 ms | — |
| extension host up | 548 ms | 585 ms | 654 ms | 1094 ms | 411 ms |
| startup complete | 300 ms | 304 ms | 334 ms | 415 ms | 217 ms |
| to text (black box) | 162 ms | 167 ms | 181 ms | 273 ms | 178 ms |
| to highlight (black box) | 281 ms | 285 ms | 316 ms | 398 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 1 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 38 ms | 15 ms | 9 ms | 9 ms | 24 ms | 7 ms | 3 ms |
| `medium` | 34 ms | 10 ms | 12 ms | 10 ms | 18 ms | 6 ms | 5 ms |
| `large` | 44 ms | 22 ms | 22 ms | 19 ms | 47 ms | 15 ms | 16 ms |
| `xlarge` | 32 ms | 35 ms | 21 ms | 24 ms | 121 ms | 15 ms | 100 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
