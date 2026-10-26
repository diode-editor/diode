# File open benchmark

- Recorded: 2026-10-26T04:31:50.708Z, commit `47a76064932c`, diode nightly-47a7606
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 62 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **145 ms** | 108 ms | 169 ms | 288 ms | 15 ms | 252 MB | 11 |
| `medium` | 126.7 KB | 2000 | **141 ms** | 104 ms | 166 ms | 291 ms | 9 ms | 275 MB | 11 |
| `large` | 1.3 MB | 20000 | **151 ms** | 114 ms | 175 ms | 289 ms | 8 ms | 294 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **242 ms** | 205 ms | 266 ms | 367 ms | 3 ms | 359 MB | 5 |
| `log500m` | 497 MB | 5295839 | **148 ms** | 111 ms | 173 ms | — (plaintext) | 2 ms | 301 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 6 ms | 6 ms | 8 ms | 6 ms |
| node ready (bootstrapComplete) | 69 ms | 67 ms | 67 ms | 75 ms | 62 ms |
| bundle executed (main:start) | 69 ms | 67 ms | 67 ms | 75 ms | 62 ms |
| config loaded | 89 ms | 87 ms | 87 ms | 96 ms | 84 ms |
| keybindings loaded | 89 ms | 87 ms | 87 ms | 98 ms | 85 ms |
| session state loaded | 89 ms | 87 ms | 87 ms | 98 ms | 85 ms |
| extensions scanned | 85 ms | 82 ms | 83 ms | 92 ms | 79 ms |
| themes ready | 93 ms | 90 ms | 91 ms | 101 ms | 88 ms |
| DI container created | 97 ms | 94 ms | 95 ms | 105 ms | 91 ms |
| workbench mounted | 132 ms | 126 ms | 126 ms | 135 ms | 120 ms |
| first frame | 131 ms | 126 ms | 126 ms | 134 ms | 120 ms |
| workbench activated | 141 ms | 130 ms | 130 ms | 138 ms | 124 ms |
| grammars preloaded | 147 ms | 142 ms | 136 ms | 144 ms | 127 ms |
| file read from disk | 150 ms | 144 ms | 150 ms | 244 ms | 141 ms |
| file decoded | 150 ms | 145 ms | 150 ms | 244 ms | 141 ms |
| document built | 150 ms | 145 ms | 150 ms | 244 ms | 141 ms |
| tokenizer attached to editor | 170 ms | 166 ms | 175 ms | 268 ms | — |
| tabs opened | 154 ms | 150 ms | 160 ms | 253 ms | 159 ms |
| built-in extensions registered | 309 ms | 311 ms | 309 ms | 385 ms | 208 ms |
| frame with file text | 168 ms | 165 ms | 174 ms | 266 ms | 173 ms |
| frame with highlighting | 287 ms | 291 ms | 289 ms | 367 ms | — |
| extension host up | 555 ms | 572 ms | 615 ms | 946 ms | 394 ms |
| startup complete | 304 ms | 306 ms | 304 ms | 381 ms | 202 ms |
| to text (black box) | 169 ms | 166 ms | 175 ms | 266 ms | 173 ms |
| to highlight (black box) | 288 ms | 291 ms | 289 ms | 367 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 44 ms | 12 ms | 11 ms | 8 ms | 22 ms | 8 ms | 3 ms |
| `medium` | 31 ms | 12 ms | 9 ms | 7 ms | 17 ms | 8 ms | 6 ms |
| `large` | 38 ms | 18 ms | 19 ms | 14 ms | 36 ms | 17 ms | 15 ms |
| `xlarge` | 32 ms | 15 ms | 9 ms | 11 ms | 92 ms | 7 ms | 74 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
