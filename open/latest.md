# File open benchmark

- Recorded: 2026-10-26T22:00:50.936Z, commit `a4cb56a0fbfd`, diode nightly-a4cb56a
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 26 ms; binary floor (`diode --version` over PTY, median): 63 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **129 ms** | 93 ms | 155 ms | 268 ms | 17 ms | 257 MB | 11 |
| `medium` | 126.7 KB | 2000 | **137 ms** | 100 ms | 163 ms | 269 ms | 8 ms | 277 MB | 11 |
| `large` | 1.3 MB | 20000 | **150 ms** | 114 ms | 176 ms | 297 ms | 17 ms | 296 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **225 ms** | 188 ms | 250 ms | 352 ms | 9 ms | 360 MB | 5 |
| `log500m` | 497 MB | 5295839 | **148 ms** | 111 ms | 174 ms | — (plaintext) | 5 ms | 269 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 7 ms | 9 ms | 6 ms |
| node ready (bootstrapComplete) | 69 ms | 69 ms | 69 ms | 80 ms | 67 ms |
| bundle executed (main:start) | 69 ms | 69 ms | 69 ms | 80 ms | 67 ms |
| config loaded | 88 ms | 88 ms | 88 ms | 99 ms | 82 ms |
| keybindings loaded | 88 ms | 88 ms | 89 ms | 99 ms | 83 ms |
| session state loaded | 89 ms | 88 ms | 90 ms | 99 ms | 83 ms |
| extensions scanned | 83 ms | 85 ms | 85 ms | 96 ms | 80 ms |
| themes ready | 91 ms | 94 ms | 93 ms | 104 ms | 89 ms |
| DI container created | 95 ms | 98 ms | 97 ms | 108 ms | 93 ms |
| workbench mounted | 124 ms | 124 ms | 123 ms | 135 ms | 122 ms |
| first frame | 124 ms | 124 ms | 123 ms | 135 ms | 122 ms |
| workbench activated | 128 ms | 128 ms | 126 ms | 140 ms | 127 ms |
| grammars preloaded | 134 ms | 136 ms | 137 ms | 149 ms | 135 ms |
| file read from disk | 137 ms | 140 ms | 154 ms | 228 ms | 146 ms |
| file decoded | 137 ms | 141 ms | 154 ms | 228 ms | 146 ms |
| document built | 137 ms | 141 ms | 154 ms | 228 ms | 146 ms |
| tokenizer attached to editor | 155 ms | 162 ms | 177 ms | 252 ms | — |
| tabs opened | 141 ms | 146 ms | 163 ms | 236 ms | 163 ms |
| built-in extensions registered | 288 ms | 290 ms | 315 ms | 372 ms | 209 ms |
| frame with file text | 154 ms | 160 ms | 176 ms | 250 ms | 174 ms |
| frame with highlighting | 268 ms | 268 ms | 296 ms | 352 ms | — |
| extension host up | 529 ms | 550 ms | 623 ms | 917 ms | 391 ms |
| startup complete | 282 ms | 283 ms | 309 ms | 366 ms | 201 ms |
| to text (black box) | 155 ms | 163 ms | 176 ms | 250 ms | 174 ms |
| to highlight (black box) | 268 ms | 269 ms | 297 ms | 352 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 3 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 32 ms | 11 ms | 10 ms | 8 ms | 16 ms | 6 ms | 4 ms |
| `medium` | 32 ms | 10 ms | 11 ms | 7 ms | 15 ms | 7 ms | 4 ms |
| `large` | 36 ms | 18 ms | 13 ms | 18 ms | 46 ms | 16 ms | 13 ms |
| `xlarge` | 31 ms | 21 ms | 11 ms | 12 ms | 110 ms | 9 ms | 74 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
