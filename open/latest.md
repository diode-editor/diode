# File open benchmark

- Recorded: 2026-11-19T05:25:37.070Z, commit `acc930b37a52`, diode nightly-acc930b
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 75 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **177 ms** | 127 ms | 201 ms | 314 ms | 19 ms | 293 MB | 11 |
| `medium` | 126.7 KB | 2000 | **174 ms** | 124 ms | 199 ms | 314 ms | 9 ms | 300 MB | 11 |
| `large` | 1.3 MB | 20000 | **196 ms** | 146 ms | 221 ms | 336 ms | 8 ms | 309 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **296 ms** | 246 ms | 321 ms | 415 ms | 7 ms | 362 MB | 5 |
| `log500m` | 497 MB | 5295839 | **185 ms** | 135 ms | 210 ms | — (plaintext) | 5 ms | 326 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 8 ms | 10 ms | 6 ms |
| node ready (bootstrapComplete) | 78 ms | 80 ms | 83 ms | 107 ms | 73 ms |
| bundle executed (main:start) | 78 ms | 80 ms | 83 ms | 107 ms | 73 ms |
| config loaded | 104 ms | 105 ms | 107 ms | 126 ms | 97 ms |
| keybindings loaded | 105 ms | 105 ms | 108 ms | 126 ms | 97 ms |
| session state loaded | 105 ms | 105 ms | 108 ms | 126 ms | 98 ms |
| extensions scanned | 96 ms | 100 ms | 101 ms | 119 ms | 90 ms |
| themes ready | 108 ms | 109 ms | 114 ms | 131 ms | 103 ms |
| DI container created | 112 ms | 113 ms | 117 ms | 136 ms | 107 ms |
| workbench mounted | 158 ms | 154 ms | 161 ms | 186 ms | 149 ms |
| first frame | 158 ms | 154 ms | 161 ms | 186 ms | 149 ms |
| workbench activated | 166 ms | 163 ms | 168 ms | 195 ms | 156 ms |
| grammars preloaded | 171 ms | 169 ms | 172 ms | 199 ms | 159 ms |
| file read from disk | 174 ms | 173 ms | 190 ms | 291 ms | 171 ms |
| file decoded | 174 ms | 173 ms | 190 ms | 291 ms | 171 ms |
| document built | 174 ms | 173 ms | 190 ms | 291 ms | 171 ms |
| tokenizer attached to editor | 199 ms | 201 ms | 220 ms | 320 ms | — |
| tabs opened | 180 ms | 182 ms | 200 ms | 303 ms | 193 ms |
| built-in extensions registered | 351 ms | 356 ms | 374 ms | 454 ms | 267 ms |
| frame with file text | 198 ms | 197 ms | 219 ms | 318 ms | 208 ms |
| frame with highlighting | 313 ms | 314 ms | 336 ms | 414 ms | — |
| extension host up | 612 ms | 651 ms | 731 ms | 1176 ms | 453 ms |
| startup complete | 338 ms | 342 ms | 360 ms | 439 ms | 252 ms |
| to text (black box) | 201 ms | 199 ms | 221 ms | 321 ms | 210 ms |
| to highlight (black box) | 314 ms | 314 ms | 336 ms | 415 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 2 ms | 2 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 39 ms | 17 ms | 12 ms | 11 ms | — | 6 ms | 4 ms |
| `medium` failed | 31 ms | 16 ms | 11 ms | 12 ms | — | 7 ms | 12 ms |
| `large` failed | 48 ms | 22 ms | 21 ms | 15 ms | — | 16 ms | 27 ms |
| `xlarge` failed | 27 ms | 38 ms | 23 ms | 29 ms | — | 14 ms | 89 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
