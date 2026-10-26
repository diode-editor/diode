# File open benchmark

- Recorded: 2026-10-26T02:53:09.402Z, commit `86ee82b9b5a8`, diode nightly-86ee82b
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 26 ms; binary floor (`diode --version` over PTY, median): 63 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **142 ms** | 105 ms | 168 ms | 283 ms | 14 ms | 252 MB | 11 |
| `medium` | 126.7 KB | 2000 | **143 ms** | 105 ms | 169 ms | 285 ms | 6 ms | 266 MB | 11 |
| `large` | 1.3 MB | 20000 | **151 ms** | 114 ms | 177 ms | 292 ms | 5 ms | 295 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **240 ms** | 203 ms | 266 ms | 376 ms | 14 ms | 362 MB | 5 |
| `log500m` | 497 MB | 5295839 | **156 ms** | 119 ms | 182 ms | — (plaintext) | 4 ms | 269 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 7 ms | 8 ms | 6 ms |
| node ready (bootstrapComplete) | 68 ms | 68 ms | 69 ms | 76 ms | 66 ms |
| bundle executed (main:start) | 68 ms | 68 ms | 69 ms | 76 ms | 66 ms |
| config loaded | 89 ms | 87 ms | 91 ms | 93 ms | 83 ms |
| keybindings loaded | 90 ms | 87 ms | 91 ms | 95 ms | 84 ms |
| session state loaded | 90 ms | 87 ms | 91 ms | 95 ms | 84 ms |
| extensions scanned | 83 ms | 83 ms | 87 ms | 88 ms | 79 ms |
| themes ready | 92 ms | 91 ms | 94 ms | 99 ms | 88 ms |
| DI container created | 96 ms | 95 ms | 98 ms | 102 ms | 92 ms |
| workbench mounted | 131 ms | 131 ms | 128 ms | 134 ms | 127 ms |
| first frame | 131 ms | 131 ms | 128 ms | 134 ms | 127 ms |
| workbench activated | 137 ms | 136 ms | 134 ms | 138 ms | 137 ms |
| grammars preloaded | 143 ms | 145 ms | 139 ms | 146 ms | 140 ms |
| file read from disk | 145 ms | 148 ms | 152 ms | 244 ms | 152 ms |
| file decoded | 145 ms | 148 ms | 152 ms | 244 ms | 152 ms |
| document built | 146 ms | 149 ms | 152 ms | 244 ms | 152 ms |
| tokenizer attached to editor | 167 ms | 170 ms | 177 ms | 266 ms | — |
| tabs opened | 150 ms | 155 ms | 162 ms | 252 ms | 170 ms |
| built-in extensions registered | 304 ms | 304 ms | 312 ms | 394 ms | 220 ms |
| frame with file text | 166 ms | 168 ms | 176 ms | 265 ms | 182 ms |
| frame with highlighting | 283 ms | 284 ms | 292 ms | 376 ms | — |
| extension host up | 556 ms | 568 ms | 639 ms | 958 ms | 414 ms |
| startup complete | 299 ms | 299 ms | 307 ms | 390 ms | 215 ms |
| to text (black box) | 168 ms | 169 ms | 177 ms | 266 ms | 182 ms |
| to highlight (black box) | 283 ms | 285 ms | 292 ms | 376 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 37 ms | 14 ms | 12 ms | 11 ms | 17 ms | 7 ms | 5 ms |
| `medium` | 33 ms | 13 ms | 11 ms | 12 ms | 16 ms | 6 ms | 13 ms |
| `large` | 36 ms | 22 ms | 15 ms | 19 ms | 49 ms | 15 ms | 15 ms |
| `xlarge` | 27 ms | 16 ms | 8 ms | 10 ms | 94 ms | 8 ms | 76 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
