# File open benchmark

- Recorded: 2026-10-31T01:06:07.955Z, commit `158bb33c7fdc`, diode nightly-158bb33
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 60 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **141 ms** | 106 ms | 166 ms | 282 ms | 7 ms | 254 MB | 11 |
| `medium` | 126.7 KB | 2000 | **149 ms** | 114 ms | 174 ms | 293 ms | 8 ms | 279 MB | 11 |
| `large` | 1.3 MB | 20000 | **160 ms** | 124 ms | 185 ms | 322 ms | 8 ms | 295 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **242 ms** | 207 ms | 267 ms | 395 ms | 10 ms | 358 MB | 5 |
| `log500m` | 497 MB | 5295839 | **156 ms** | 121 ms | 181 ms | — (plaintext) | 2 ms | 302 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 7 ms | 8 ms | 6 ms |
| node ready (bootstrapComplete) | 66 ms | 67 ms | 70 ms | 77 ms | 65 ms |
| bundle executed (main:start) | 66 ms | 67 ms | 70 ms | 77 ms | 65 ms |
| config loaded | 83 ms | 85 ms | 89 ms | 94 ms | 86 ms |
| keybindings loaded | 83 ms | 87 ms | 90 ms | 96 ms | 86 ms |
| session state loaded | 83 ms | 88 ms | 90 ms | 96 ms | 86 ms |
| extensions scanned | 79 ms | 82 ms | 86 ms | 91 ms | 81 ms |
| themes ready | 89 ms | 92 ms | 94 ms | 100 ms | 90 ms |
| DI container created | 94 ms | 97 ms | 98 ms | 105 ms | 94 ms |
| workbench mounted | 128 ms | 131 ms | 133 ms | 138 ms | 126 ms |
| first frame | 128 ms | 131 ms | 133 ms | 138 ms | 126 ms |
| workbench activated | 138 ms | 141 ms | 139 ms | 144 ms | 130 ms |
| grammars preloaded | 143 ms | 146 ms | 144 ms | 149 ms | 133 ms |
| file read from disk | 145 ms | 150 ms | 156 ms | 244 ms | 146 ms |
| file decoded | 145 ms | 150 ms | 156 ms | 244 ms | 146 ms |
| document built | 145 ms | 150 ms | 156 ms | 244 ms | 146 ms |
| tokenizer attached to editor | 167 ms | 180 ms | 200 ms | 283 ms | — |
| tabs opened | 149 ms | 156 ms | 168 ms | 254 ms | 166 ms |
| built-in extensions registered | 309 ms | 319 ms | 345 ms | 419 ms | 221 ms |
| frame with file text | 165 ms | 170 ms | 182 ms | 267 ms | 180 ms |
| frame with highlighting | 282 ms | 290 ms | 322 ms | 395 ms | — |
| extension host up | 544 ms | 589 ms | 669 ms | 1085 ms | 402 ms |
| startup complete | 303 ms | 311 ms | 339 ms | 412 ms | 214 ms |
| to text (black box) | 166 ms | 174 ms | 185 ms | 267 ms | 181 ms |
| to highlight (black box) | 282 ms | 293 ms | 322 ms | 395 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 1 ms | 0 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 35 ms | 13 ms | 11 ms | 10 ms | 18 ms | 6 ms | 4 ms |
| `medium` | 32 ms | 13 ms | 12 ms | 9 ms | 16 ms | 8 ms | 5 ms |
| `large` | 36 ms | 19 ms | 17 ms | 16 ms | 49 ms | 16 ms | 16 ms |
| `xlarge` | 27 ms | 20 ms | 10 ms | 13 ms | 103 ms | 9 ms | 81 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
