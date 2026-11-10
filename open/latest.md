# File open benchmark

- Recorded: 2026-11-10T04:53:00.381Z, commit `4c73aab4c3df`, diode nightly-4c73aab
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 26 ms; binary floor (`diode --version` over PTY, median): 68 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **177 ms** | 134 ms | 202 ms | 326 ms | 23 ms | 271 MB | 11 |
| `medium` | 126.7 KB | 2000 | **173 ms** | 130 ms | 198 ms | 314 ms | 12 ms | 290 MB | 11 |
| `large` | 1.3 MB | 20000 | **186 ms** | 143 ms | 211 ms | 325 ms | 8 ms | 298 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **280 ms** | 237 ms | 305 ms | 410 ms | 9 ms | 352 MB | 5 |
| `log500m` | 497 MB | 5295839 | **184 ms** | 142 ms | 210 ms | — (plaintext) | 2 ms | 308 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 7 ms | 11 ms | 6 ms |
| node ready (bootstrapComplete) | 79 ms | 78 ms | 76 ms | 95 ms | 71 ms |
| bundle executed (main:start) | 79 ms | 78 ms | 76 ms | 95 ms | 71 ms |
| config loaded | 102 ms | 96 ms | 98 ms | 117 ms | 90 ms |
| keybindings loaded | 102 ms | 98 ms | 98 ms | 117 ms | 90 ms |
| session state loaded | 102 ms | 98 ms | 98 ms | 117 ms | 91 ms |
| extensions scanned | 99 ms | 92 ms | 93 ms | 113 ms | 85 ms |
| themes ready | 106 ms | 102 ms | 103 ms | 123 ms | 96 ms |
| DI container created | 110 ms | 107 ms | 108 ms | 126 ms | 101 ms |
| workbench mounted | 159 ms | 154 ms | 154 ms | 164 ms | 150 ms |
| first frame | 159 ms | 153 ms | 153 ms | 164 ms | 150 ms |
| workbench activated | 166 ms | 161 ms | 160 ms | 171 ms | 157 ms |
| grammars preloaded | 174 ms | 168 ms | 166 ms | 177 ms | 161 ms |
| file read from disk | 177 ms | 172 ms | 183 ms | 277 ms | 173 ms |
| file decoded | 177 ms | 172 ms | 183 ms | 277 ms | 173 ms |
| document built | 177 ms | 172 ms | 183 ms | 277 ms | 173 ms |
| tokenizer attached to editor | 202 ms | 197 ms | 213 ms | 307 ms | — |
| tabs opened | 183 ms | 180 ms | 193 ms | 287 ms | 195 ms |
| built-in extensions registered | 356 ms | 341 ms | 355 ms | 439 ms | 257 ms |
| frame with file text | 201 ms | 195 ms | 211 ms | 305 ms | 209 ms |
| frame with highlighting | 326 ms | 314 ms | 325 ms | 410 ms | — |
| extension host up | 633 ms | 638 ms | 694 ms | 1152 ms | 461 ms |
| startup complete | 347 ms | 333 ms | 346 ms | 429 ms | 247 ms |
| to text (black box) | 202 ms | 198 ms | 211 ms | 305 ms | 210 ms |
| to highlight (black box) | 326 ms | 314 ms | 325 ms | 410 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 40 ms | 14 ms | 13 ms | 18 ms | — | 11 ms | 5 ms |
| `medium` failed | 37 ms | 16 ms | 14 ms | 12 ms | — | 8 ms | 7 ms |
| `large` failed | 44 ms | 20 ms | 23 ms | 20 ms | — | 16 ms | 17 ms |
| `xlarge` failed | 30 ms | 43 ms | 25 ms | 70 ms | — | 29 ms | 75 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
