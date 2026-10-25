# File open benchmark

- Recorded: 2026-10-25T15:24:17.013Z, commit `6e36f6f9025a`, diode nightly-6e36f6f
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 58 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **139 ms** | 105 ms | 164 ms | 276 ms | 20 ms | 250 MB | 11 |
| `medium` | 126.7 KB | 2000 | **141 ms** | 108 ms | 166 ms | 281 ms | 8 ms | 262 MB | 11 |
| `large` | 1.3 MB | 20000 | **158 ms** | 125 ms | 183 ms | 300 ms | 10 ms | 286 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **246 ms** | 213 ms | 271 ms | 373 ms | 20 ms | 349 MB | 5 |
| `log500m` | 497 MB | 5295839 | **155 ms** | 121 ms | 180 ms | — (plaintext) | 5 ms | 263 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 8 ms | 9 ms | 7 ms |
| node ready (bootstrapComplete) | 68 ms | 68 ms | 71 ms | 77 ms | 64 ms |
| bundle executed (main:start) | 68 ms | 68 ms | 71 ms | 77 ms | 64 ms |
| config loaded | 83 ms | 87 ms | 89 ms | 100 ms | 83 ms |
| keybindings loaded | 85 ms | 88 ms | 90 ms | 100 ms | 84 ms |
| session state loaded | 85 ms | 88 ms | 90 ms | 100 ms | 85 ms |
| extensions scanned | 79 ms | 82 ms | 84 ms | 95 ms | 79 ms |
| themes ready | 88 ms | 92 ms | 94 ms | 103 ms | 89 ms |
| DI container created | 93 ms | 96 ms | 98 ms | 107 ms | 94 ms |
| workbench mounted | 125 ms | 126 ms | 129 ms | 135 ms | 124 ms |
| first frame | 125 ms | 126 ms | 128 ms | 135 ms | 124 ms |
| workbench activated | 131 ms | 131 ms | 134 ms | 141 ms | 130 ms |
| grammars preloaded | 139 ms | 140 ms | 144 ms | 151 ms | 134 ms |
| file read from disk | 141 ms | 143 ms | 159 ms | 249 ms | 147 ms |
| file decoded | 141 ms | 143 ms | 159 ms | 249 ms | 147 ms |
| document built | 141 ms | 143 ms | 159 ms | 249 ms | 148 ms |
| tokenizer attached to editor | 162 ms | 167 ms | 184 ms | 273 ms | — |
| tabs opened | 145 ms | 149 ms | 168 ms | 258 ms | 167 ms |
| built-in extensions registered | 298 ms | 302 ms | 319 ms | 394 ms | 216 ms |
| frame with file text | 161 ms | 165 ms | 182 ms | 271 ms | 179 ms |
| frame with highlighting | 276 ms | 280 ms | 300 ms | 373 ms | — |
| extension host up | 526 ms | 547 ms | 612 ms | 938 ms | 390 ms |
| startup complete | 294 ms | 297 ms | 314 ms | 388 ms | 210 ms |
| to text (black box) | 164 ms | 166 ms | 183 ms | 271 ms | 180 ms |
| to highlight (black box) | 276 ms | 281 ms | 300 ms | 373 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 1 ms | 0 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 33 ms | 11 ms | 10 ms | 12 ms | 18 ms | 6 ms | 3 ms |
| `medium` | 33 ms | 13 ms | 12 ms | 10 ms | 17 ms | 7 ms | 7 ms |
| `large` | 34 ms | 22 ms | 17 ms | 16 ms | 46 ms | 13 ms | 14 ms |
| `xlarge` | 32 ms | 18 ms | 9 ms | 12 ms | 97 ms | 9 ms | 77 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
