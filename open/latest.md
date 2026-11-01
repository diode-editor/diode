# File open benchmark

- Recorded: 2026-11-01T03:46:37.563Z, commit `23f4507d4d82`, diode nightly-23f4507
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 27 ms; binary floor (`diode --version` over PTY, median): 62 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **136 ms** | 101 ms | 163 ms | 274 ms | 12 ms | 270 MB | 11 |
| `medium` | 126.7 KB | 2000 | **141 ms** | 105 ms | 168 ms | 288 ms | 8 ms | 280 MB | 11 |
| `large` | 1.3 MB | 20000 | **152 ms** | 117 ms | 179 ms | 309 ms | 10 ms | 297 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **243 ms** | 208 ms | 270 ms | 398 ms | 29 ms | 363 MB | 5 |
| `log500m` | 497 MB | 5295839 | **158 ms** | 123 ms | 185 ms | — (plaintext) | 18 ms | 271 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 7 ms | 10 ms | 6 ms |
| node ready (bootstrapComplete) | 66 ms | 68 ms | 67 ms | 82 ms | 64 ms |
| bundle executed (main:start) | 66 ms | 68 ms | 67 ms | 82 ms | 64 ms |
| config loaded | 86 ms | 88 ms | 85 ms | 106 ms | 84 ms |
| keybindings loaded | 87 ms | 89 ms | 85 ms | 106 ms | 86 ms |
| session state loaded | 87 ms | 89 ms | 86 ms | 107 ms | 86 ms |
| extensions scanned | 82 ms | 83 ms | 82 ms | 99 ms | 80 ms |
| themes ready | 91 ms | 94 ms | 90 ms | 109 ms | 89 ms |
| DI container created | 95 ms | 98 ms | 95 ms | 113 ms | 93 ms |
| workbench mounted | 128 ms | 128 ms | 129 ms | 143 ms | 125 ms |
| first frame | 128 ms | 128 ms | 129 ms | 143 ms | 125 ms |
| workbench activated | 134 ms | 133 ms | 138 ms | 153 ms | 136 ms |
| grammars preloaded | 140 ms | 139 ms | 143 ms | 158 ms | 138 ms |
| file read from disk | 143 ms | 143 ms | 155 ms | 247 ms | 150 ms |
| file decoded | 143 ms | 143 ms | 155 ms | 247 ms | 150 ms |
| document built | 143 ms | 144 ms | 155 ms | 248 ms | 150 ms |
| tokenizer attached to editor | 163 ms | 175 ms | 195 ms | 286 ms | — |
| tabs opened | 147 ms | 151 ms | 163 ms | 257 ms | 169 ms |
| built-in extensions registered | 302 ms | 314 ms | 332 ms | 421 ms | 226 ms |
| frame with file text | 161 ms | 167 ms | 178 ms | 270 ms | 184 ms |
| frame with highlighting | 274 ms | 288 ms | 309 ms | 398 ms | — |
| extension host up | 556 ms | 587 ms | 637 ms | 1078 ms | 407 ms |
| startup complete | 295 ms | 308 ms | 327 ms | 415 ms | 219 ms |
| to text (black box) | 163 ms | 168 ms | 179 ms | 270 ms | 185 ms |
| to highlight (black box) | 274 ms | 288 ms | 309 ms | 398 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 1 ms | 0 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 38 ms | 12 ms | 8 ms | 9 ms | 20 ms | 9 ms | 3 ms |
| `medium` | 33 ms | 12 ms | 11 ms | 9 ms | 24 ms | 7 ms | 4 ms |
| `large` | 39 ms | 21 ms | 24 ms | 23 ms | 45 ms | 12 ms | 14 ms |
| `xlarge` | 31 ms | 21 ms | 19 ms | 20 ms | 125 ms | 14 ms | 64 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
