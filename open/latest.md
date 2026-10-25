# File open benchmark

- Recorded: 2026-10-25T15:26:44.120Z, commit `5eb977e97c4f`, diode nightly-5eb977e
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 23 ms; binary floor (`diode --version` over PTY, median): 59 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **134 ms** | 97 ms | 156 ms | 267 ms | 13 ms | 248 MB | 11 |
| `medium` | 126.7 KB | 2000 | **138 ms** | 102 ms | 161 ms | 275 ms | 11 ms | 247 MB | 11 |
| `large` | 1.3 MB | 20000 | **157 ms** | 121 ms | 180 ms | 294 ms | 8 ms | 283 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **246 ms** | 209 ms | 268 ms | 365 ms | 5 ms | 349 MB | 5 |
| `log500m` | 497 MB | 5295839 | **148 ms** | 111 ms | 170 ms | — (plaintext) | 1 ms | 289 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 7 ms | 9 ms | 6 ms |
| node ready (bootstrapComplete) | 65 ms | 65 ms | 69 ms | 77 ms | 61 ms |
| bundle executed (main:start) | 66 ms | 65 ms | 69 ms | 77 ms | 61 ms |
| config loaded | 85 ms | 83 ms | 89 ms | 95 ms | 84 ms |
| keybindings loaded | 85 ms | 83 ms | 89 ms | 98 ms | 84 ms |
| session state loaded | 85 ms | 83 ms | 89 ms | 98 ms | 84 ms |
| extensions scanned | 80 ms | 78 ms | 85 ms | 90 ms | 81 ms |
| themes ready | 88 ms | 87 ms | 93 ms | 101 ms | 87 ms |
| DI container created | 92 ms | 92 ms | 97 ms | 105 ms | 90 ms |
| workbench mounted | 122 ms | 122 ms | 128 ms | 133 ms | 117 ms |
| first frame | 122 ms | 122 ms | 128 ms | 133 ms | 117 ms |
| workbench activated | 127 ms | 127 ms | 134 ms | 139 ms | 122 ms |
| grammars preloaded | 133 ms | 135 ms | 140 ms | 145 ms | 125 ms |
| file read from disk | 136 ms | 139 ms | 157 ms | 244 ms | 137 ms |
| file decoded | 136 ms | 139 ms | 157 ms | 244 ms | 137 ms |
| document built | 136 ms | 139 ms | 157 ms | 244 ms | 138 ms |
| tokenizer attached to editor | 156 ms | 161 ms | 181 ms | 270 ms | — |
| tabs opened | 139 ms | 144 ms | 166 ms | 253 ms | 159 ms |
| built-in extensions registered | 290 ms | 294 ms | 315 ms | 383 ms | 208 ms |
| frame with file text | 155 ms | 158 ms | 179 ms | 268 ms | 170 ms |
| frame with highlighting | 267 ms | 274 ms | 293 ms | 365 ms | — |
| extension host up | 511 ms | 541 ms | 609 ms | 927 ms | 388 ms |
| startup complete | 283 ms | 289 ms | 309 ms | 378 ms | 201 ms |
| to text (black box) | 156 ms | 161 ms | 180 ms | 268 ms | 170 ms |
| to highlight (black box) | 267 ms | 275 ms | 294 ms | 365 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 31 ms | 12 ms | 8 ms | 9 ms | 14 ms | 10 ms | 4 ms |
| `medium` | 35 ms | 16 ms | 11 ms | 9 ms | 12 ms | 6 ms | 7 ms |
| `large` | 38 ms | 25 ms | 14 ms | 16 ms | 46 ms | 11 ms | 18 ms |
| `xlarge` | 28 ms | 18 ms | 10 ms | 10 ms | 95 ms | 12 ms | 82 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
