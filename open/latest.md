# File open benchmark

- Recorded: 2026-10-24T17:53:46.028Z, commit `dfe95974c298`, diode nightly-dfe9597
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 23 ms; binary floor (`diode --version` over PTY, median): 59 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **138 ms** | 103 ms | 161 ms | 274 ms | 17 ms | 244 MB | 11 |
| `medium` | 126.7 KB | 2000 | **143 ms** | 107 ms | 166 ms | 280 ms | 7 ms | 245 MB | 11 |
| `large` | 1.3 MB | 20000 | **153 ms** | 118 ms | 177 ms | 294 ms | 8 ms | 287 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **238 ms** | 202 ms | 261 ms | 361 ms | 8 ms | 354 MB | 5 |
| `log500m` | 497 MB | 5295839 | **147 ms** | 112 ms | 171 ms | — (plaintext) | 3 ms | 293 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 6 ms | 7 ms | 8 ms | 6 ms |
| node ready (bootstrapComplete) | 64 ms | 66 ms | 67 ms | 78 ms | 60 ms |
| bundle executed (main:start) | 64 ms | 66 ms | 67 ms | 78 ms | 60 ms |
| config loaded | 86 ms | 82 ms | 86 ms | 97 ms | 83 ms |
| keybindings loaded | 86 ms | 83 ms | 86 ms | 97 ms | 83 ms |
| session state loaded | 86 ms | 83 ms | 86 ms | 98 ms | 83 ms |
| extensions scanned | 79 ms | 79 ms | 82 ms | 93 ms | 81 ms |
| themes ready | 89 ms | 87 ms | 90 ms | 100 ms | 86 ms |
| DI container created | 93 ms | 91 ms | 95 ms | 104 ms | 90 ms |
| workbench mounted | 123 ms | 124 ms | 126 ms | 131 ms | 117 ms |
| first frame | 123 ms | 124 ms | 126 ms | 131 ms | 117 ms |
| workbench activated | 129 ms | 129 ms | 132 ms | 137 ms | 121 ms |
| grammars preloaded | 138 ms | 140 ms | 143 ms | 143 ms | 124 ms |
| file read from disk | 141 ms | 143 ms | 155 ms | 239 ms | 136 ms |
| file decoded | 141 ms | 143 ms | 155 ms | 239 ms | 136 ms |
| document built | 141 ms | 143 ms | 155 ms | 240 ms | 136 ms |
| tokenizer attached to editor | 159 ms | 165 ms | 178 ms | 263 ms | — |
| tabs opened | 145 ms | 149 ms | 164 ms | 248 ms | 156 ms |
| built-in extensions registered | 294 ms | 300 ms | 314 ms | 380 ms | 207 ms |
| frame with file text | 158 ms | 163 ms | 176 ms | 261 ms | 170 ms |
| frame with highlighting | 273 ms | 279 ms | 294 ms | 361 ms | — |
| extension host up | 514 ms | 541 ms | 603 ms | 922 ms | 378 ms |
| startup complete | 289 ms | 296 ms | 309 ms | 375 ms | 201 ms |
| to text (black box) | 161 ms | 166 ms | 177 ms | 261 ms | 171 ms |
| to highlight (black box) | 274 ms | 280 ms | 294 ms | 361 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 0 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 37 ms | 10 ms | 9 ms | 11 ms | 17 ms | 7 ms | 3 ms |
| `medium` | 35 ms | 14 ms | 10 ms | 8 ms | 14 ms | 8 ms | 5 ms |
| `large` | 35 ms | 20 ms | 14 ms | 18 ms | 38 ms | 11 ms | 13 ms |
| `xlarge` | 29 ms | 20 ms | 13 ms | 14 ms | 111 ms | 12 ms | 74 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
