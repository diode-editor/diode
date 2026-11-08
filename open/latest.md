# File open benchmark

- Recorded: 2026-11-08T09:30:26.296Z, commit `d55d1c58686e`, diode nightly-d55d1c5
- Machine: Intel(R) Xeon(R) Platinum 8370C CPU @ 2.80GHz (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 24 ms; binary floor (`diode --version` over PTY, median): 65 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **157 ms** | 117 ms | 182 ms | 305 ms | 15 ms | 276 MB | 11 |
| `medium` | 126.7 KB | 2000 | **156 ms** | 115 ms | 180 ms | 301 ms | 6 ms | 287 MB | 11 |
| `large` | 1.3 MB | 20000 | **179 ms** | 138 ms | 203 ms | 324 ms | 6 ms | 297 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **258 ms** | 217 ms | 282 ms | 385 ms | 9 ms | 352 MB | 5 |
| `log500m` | 497 MB | 5295839 | **162 ms** | 121 ms | 186 ms | — (plaintext) | 5 ms | 280 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 6 ms | 6 ms | 5 ms |
| node ready (bootstrapComplete) | 68 ms | 67 ms | 72 ms | 83 ms | 64 ms |
| bundle executed (main:start) | 68 ms | 67 ms | 72 ms | 83 ms | 64 ms |
| config loaded | 88 ms | 92 ms | 89 ms | 104 ms | 81 ms |
| keybindings loaded | 91 ms | 92 ms | 90 ms | 108 ms | 82 ms |
| session state loaded | 91 ms | 93 ms | 91 ms | 108 ms | 83 ms |
| extensions scanned | 84 ms | 87 ms | 86 ms | 100 ms | 77 ms |
| themes ready | 94 ms | 96 ms | 95 ms | 112 ms | 88 ms |
| DI container created | 98 ms | 99 ms | 99 ms | 115 ms | 92 ms |
| workbench mounted | 137 ms | 134 ms | 146 ms | 149 ms | 127 ms |
| first frame | 137 ms | 134 ms | 146 ms | 149 ms | 127 ms |
| workbench activated | 149 ms | 143 ms | 153 ms | 156 ms | 141 ms |
| grammars preloaded | 155 ms | 150 ms | 160 ms | 162 ms | 143 ms |
| file read from disk | 158 ms | 154 ms | 174 ms | 251 ms | 153 ms |
| file decoded | 158 ms | 154 ms | 174 ms | 251 ms | 153 ms |
| document built | 158 ms | 154 ms | 174 ms | 252 ms | 153 ms |
| tokenizer attached to editor | 178 ms | 179 ms | 203 ms | 282 ms | — |
| tabs opened | 164 ms | 161 ms | 185 ms | 262 ms | 170 ms |
| built-in extensions registered | 327 ms | 324 ms | 347 ms | 409 ms | 224 ms |
| frame with file text | 177 ms | 177 ms | 201 ms | 279 ms | 186 ms |
| frame with highlighting | 305 ms | 301 ms | 324 ms | 385 ms | — |
| extension host up | 575 ms | 622 ms | 670 ms | 1094 ms | 411 ms |
| startup complete | 318 ms | 314 ms | 339 ms | 398 ms | 215 ms |
| to text (black box) | 182 ms | 180 ms | 203 ms | 282 ms | 186 ms |
| to highlight (black box) | 305 ms | 301 ms | 324 ms | 385 ms | — |
| gap black − white (text) | 2 ms | 1 ms | 2 ms | 3 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 35 ms | 17 ms | 13 ms | 11 ms | — | 9 ms | 4 ms |
| `medium` failed | 34 ms | 16 ms | 13 ms | 12 ms | — | 6 ms | 7 ms |
| `large` failed | 34 ms | 26 ms | 25 ms | 19 ms | — | 20 ms | 19 ms |
| `xlarge` failed | 28 ms | 37 ms | 22 ms | 18 ms | — | 16 ms | 100 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
