# File open benchmark

- Recorded: 2026-11-10T21:34:59.633Z, commit `58626374a51c`, diode nightly-5862637
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 24 ms; binary floor (`diode --version` over PTY, median): 65 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **157 ms** | 116 ms | 181 ms | 292 ms | 11 ms | 279 MB | 11 |
| `medium` | 126.7 KB | 2000 | **159 ms** | 118 ms | 183 ms | 300 ms | 9 ms | 288 MB | 11 |
| `large` | 1.3 MB | 20000 | **179 ms** | 137 ms | 202 ms | 313 ms | 6 ms | 298 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **276 ms** | 234 ms | 300 ms | 394 ms | 7 ms | 354 MB | 5 |
| `log500m` | 497 MB | 5295839 | **176 ms** | 134 ms | 199 ms | — (plaintext) | 5 ms | 313 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 6 ms | 7 ms | 10 ms | 6 ms |
| node ready (bootstrapComplete) | 70 ms | 69 ms | 76 ms | 89 ms | 67 ms |
| bundle executed (main:start) | 70 ms | 69 ms | 76 ms | 89 ms | 68 ms |
| config loaded | 92 ms | 91 ms | 97 ms | 113 ms | 90 ms |
| keybindings loaded | 92 ms | 92 ms | 97 ms | 113 ms | 93 ms |
| session state loaded | 92 ms | 92 ms | 97 ms | 113 ms | 93 ms |
| extensions scanned | 86 ms | 86 ms | 91 ms | 105 ms | 84 ms |
| themes ready | 97 ms | 95 ms | 101 ms | 117 ms | 96 ms |
| DI container created | 101 ms | 99 ms | 106 ms | 121 ms | 100 ms |
| workbench mounted | 142 ms | 139 ms | 150 ms | 159 ms | 138 ms |
| first frame | 142 ms | 139 ms | 150 ms | 159 ms | 138 ms |
| workbench activated | 149 ms | 147 ms | 157 ms | 168 ms | 145 ms |
| grammars preloaded | 155 ms | 152 ms | 163 ms | 174 ms | 148 ms |
| file read from disk | 157 ms | 156 ms | 176 ms | 269 ms | 160 ms |
| file decoded | 157 ms | 156 ms | 176 ms | 269 ms | 160 ms |
| document built | 158 ms | 157 ms | 176 ms | 270 ms | 160 ms |
| tokenizer attached to editor | 180 ms | 183 ms | 204 ms | 299 ms | — |
| tabs opened | 163 ms | 163 ms | 186 ms | 281 ms | 180 ms |
| built-in extensions registered | 321 ms | 329 ms | 341 ms | 424 ms | 246 ms |
| frame with file text | 179 ms | 181 ms | 202 ms | 298 ms | 198 ms |
| frame with highlighting | 291 ms | 299 ms | 313 ms | 394 ms | — |
| extension host up | 572 ms | 622 ms | 707 ms | 1156 ms | 445 ms |
| startup complete | 311 ms | 320 ms | 332 ms | 414 ms | 235 ms |
| to text (black box) | 181 ms | 183 ms | 202 ms | 300 ms | 199 ms |
| to highlight (black box) | 292 ms | 300 ms | 313 ms | 394 ms | — |
| gap black − white (text) | 2 ms | 1 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 32 ms | 11 ms | 10 ms | 11 ms | — | 8 ms | 4 ms |
| `medium` failed | 31 ms | 16 ms | 12 ms | 11 ms | — | 9 ms | 6 ms |
| `large` failed | 38 ms | 19 ms | 22 ms | 19 ms | — | 18 ms | 19 ms |
| `xlarge` failed | 32 ms | 44 ms | 27 ms | 38 ms | — | 26 ms | 94 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
