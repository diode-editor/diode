# File open benchmark

- Recorded: 2026-10-26T03:09:55.238Z, commit `abda294a5bf4`, diode nightly-abda294
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 23 ms; binary floor (`diode --version` over PTY, median): 59 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **139 ms** | 103 ms | 162 ms | 275 ms | 18 ms | 255 MB | 11 |
| `medium` | 126.7 KB | 2000 | **137 ms** | 101 ms | 160 ms | 274 ms | 10 ms | 267 MB | 11 |
| `large` | 1.3 MB | 20000 | **148 ms** | 112 ms | 171 ms | 284 ms | 7 ms | 297 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **257 ms** | 221 ms | 280 ms | 379 ms | 12 ms | 362 MB | 5 |
| `log500m` | 497 MB | 5295839 | **149 ms** | 113 ms | 172 ms | — (plaintext) | 1 ms | 272 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 6 ms | 6 ms | 8 ms | 6 ms |
| node ready (bootstrapComplete) | 65 ms | 64 ms | 68 ms | 78 ms | 60 ms |
| bundle executed (main:start) | 65 ms | 64 ms | 68 ms | 78 ms | 60 ms |
| config loaded | 84 ms | 84 ms | 86 ms | 97 ms | 75 ms |
| keybindings loaded | 85 ms | 84 ms | 88 ms | 98 ms | 75 ms |
| session state loaded | 85 ms | 84 ms | 88 ms | 98 ms | 75 ms |
| extensions scanned | 80 ms | 79 ms | 83 ms | 94 ms | 72 ms |
| themes ready | 89 ms | 88 ms | 90 ms | 102 ms | 80 ms |
| DI container created | 93 ms | 92 ms | 94 ms | 107 ms | 85 ms |
| workbench mounted | 125 ms | 121 ms | 125 ms | 143 ms | 119 ms |
| first frame | 125 ms | 121 ms | 125 ms | 143 ms | 119 ms |
| workbench activated | 131 ms | 126 ms | 130 ms | 149 ms | 123 ms |
| grammars preloaded | 138 ms | 136 ms | 135 ms | 160 ms | 129 ms |
| file read from disk | 140 ms | 140 ms | 147 ms | 251 ms | 141 ms |
| file decoded | 140 ms | 140 ms | 147 ms | 251 ms | 141 ms |
| document built | 140 ms | 140 ms | 148 ms | 251 ms | 141 ms |
| tokenizer attached to editor | 161 ms | 162 ms | 173 ms | 280 ms | — |
| tabs opened | 144 ms | 147 ms | 158 ms | 261 ms | 159 ms |
| built-in extensions registered | 294 ms | 297 ms | 304 ms | 398 ms | 206 ms |
| frame with file text | 160 ms | 160 ms | 171 ms | 278 ms | 171 ms |
| frame with highlighting | 274 ms | 274 ms | 284 ms | 379 ms | — |
| extension host up | 528 ms | 549 ms | 611 ms | 930 ms | 382 ms |
| startup complete | 289 ms | 291 ms | 299 ms | 393 ms | 200 ms |
| to text (black box) | 162 ms | 160 ms | 171 ms | 280 ms | 172 ms |
| to highlight (black box) | 275 ms | 274 ms | 284 ms | 379 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 35 ms | 13 ms | 12 ms | 10 ms | 14 ms | 8 ms | 4 ms |
| `medium` | 29 ms | 13 ms | 11 ms | 9 ms | 15 ms | 6 ms | 6 ms |
| `large` | 39 ms | 18 ms | 21 ms | 16 ms | 43 ms | 15 ms | 15 ms |
| `xlarge` | 28 ms | 24 ms | 13 ms | 19 ms | 124 ms | 18 ms | 84 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
