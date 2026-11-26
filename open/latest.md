# File open benchmark

- Recorded: 2026-11-26T00:53:09.880Z, commit `e8f0323ac2dd`, diode nightly-e8f0323
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1020-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 71 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **168 ms** | 122 ms | 193 ms | 309 ms | 12 ms | 297 MB | 11 |
| `medium` | 126.7 KB | 2000 | **172 ms** | 126 ms | 197 ms | 316 ms | 5 ms | 303 MB | 11 |
| `large` | 1.3 MB | 20000 | **189 ms** | 142 ms | 213 ms | 324 ms | 10 ms | 315 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **280 ms** | 234 ms | 305 ms | 403 ms | 14 ms | 363 MB | 5 |
| `log500m` | 497 MB | 5295839 | **185 ms** | 138 ms | 209 ms | — (plaintext) | 4 ms | 326 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 6 ms | 6 ms | 10 ms | 5 ms |
| node ready (bootstrapComplete) | 79 ms | 75 ms | 78 ms | 92 ms | 72 ms |
| bundle executed (main:start) | 79 ms | 75 ms | 78 ms | 92 ms | 72 ms |
| config loaded | 100 ms | 98 ms | 97 ms | 109 ms | 94 ms |
| keybindings loaded | 101 ms | 100 ms | 98 ms | 111 ms | 97 ms |
| session state loaded | 101 ms | 101 ms | 98 ms | 112 ms | 97 ms |
| extensions scanned | 93 ms | 91 ms | 91 ms | 103 ms | 87 ms |
| themes ready | 106 ms | 105 ms | 106 ms | 116 ms | 101 ms |
| DI container created | 110 ms | 108 ms | 110 ms | 120 ms | 104 ms |
| workbench mounted | 154 ms | 155 ms | 160 ms | 173 ms | 149 ms |
| first frame | 154 ms | 155 ms | 160 ms | 173 ms | 149 ms |
| workbench activated | 161 ms | 162 ms | 167 ms | 180 ms | 156 ms |
| grammars preloaded | 167 ms | 167 ms | 173 ms | 186 ms | 159 ms |
| file read from disk | 169 ms | 171 ms | 186 ms | 279 ms | 171 ms |
| file decoded | 169 ms | 171 ms | 186 ms | 279 ms | 171 ms |
| document built | 169 ms | 171 ms | 186 ms | 279 ms | 171 ms |
| tokenizer attached to editor | 192 ms | 197 ms | 214 ms | 306 ms | — |
| tabs opened | 175 ms | 178 ms | 196 ms | 289 ms | 193 ms |
| built-in extensions registered | 343 ms | 349 ms | 357 ms | 437 ms | 263 ms |
| frame with file text | 191 ms | 196 ms | 212 ms | 305 ms | 208 ms |
| frame with highlighting | 309 ms | 314 ms | 324 ms | 403 ms | — |
| extension host up | 594 ms | 648 ms | 704 ms | 1150 ms | 448 ms |
| startup complete | 331 ms | 337 ms | 345 ms | 424 ms | 250 ms |
| to text (black box) | 193 ms | 197 ms | 213 ms | 305 ms | 209 ms |
| to highlight (black box) | 309 ms | 316 ms | 324 ms | 403 ms | — |
| gap black − white (text) | 2 ms | 1 ms | 1 ms | 0 ms | 2 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 34 ms | 14 ms | 11 ms | 14 ms | — | 7 ms | 4 ms |
| `medium` failed | 34 ms | 17 ms | 13 ms | 11 ms | — | 7 ms | 6 ms |
| `large` failed | 37 ms | 27 ms | 23 ms | 19 ms | — | 21 ms | 19 ms |
| `xlarge` failed | 28 ms | 37 ms | 16 ms | 17 ms | — | 15 ms | 108 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
