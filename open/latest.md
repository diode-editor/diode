# File open benchmark

- Recorded: 2026-11-18T06:18:41.778Z, commit `91aa18669e99`, diode nightly-91aa186
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 22 ms; binary floor (`diode --version` over PTY, median): 62 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **145 ms** | 106 ms | 167 ms | 255 ms | 9 ms | 293 MB | 11 |
| `medium` | 126.7 KB | 2000 | **149 ms** | 109 ms | 171 ms | 261 ms | 6 ms | 299 MB | 11 |
| `large` | 1.3 MB | 20000 | **157 ms** | 117 ms | 179 ms | 272 ms | 5 ms | 316 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **223 ms** | 184 ms | 246 ms | 320 ms | 11 ms | 363 MB | 5 |
| `log500m` | 497 MB | 5295839 | **154 ms** | 115 ms | 177 ms | — (plaintext) | 12 ms | 316 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 6 ms | 8 ms | 5 ms |
| node ready (bootstrapComplete) | 70 ms | 70 ms | 71 ms | 79 ms | 64 ms |
| bundle executed (main:start) | 70 ms | 70 ms | 71 ms | 79 ms | 64 ms |
| config loaded | 88 ms | 91 ms | 93 ms | 101 ms | 80 ms |
| keybindings loaded | 90 ms | 91 ms | 93 ms | 101 ms | 81 ms |
| session state loaded | 90 ms | 91 ms | 93 ms | 101 ms | 81 ms |
| extensions scanned | 83 ms | 84 ms | 86 ms | 96 ms | 76 ms |
| themes ready | 93 ms | 94 ms | 96 ms | 105 ms | 85 ms |
| DI container created | 96 ms | 97 ms | 99 ms | 109 ms | 89 ms |
| workbench mounted | 132 ms | 133 ms | 133 ms | 147 ms | 127 ms |
| first frame | 132 ms | 133 ms | 133 ms | 147 ms | 127 ms |
| workbench activated | 139 ms | 142 ms | 141 ms | 152 ms | 139 ms |
| grammars preloaded | 143 ms | 147 ms | 145 ms | 157 ms | 141 ms |
| file read from disk | 145 ms | 151 ms | 158 ms | 226 ms | 150 ms |
| file decoded | 145 ms | 151 ms | 158 ms | 226 ms | 150 ms |
| document built | 145 ms | 151 ms | 158 ms | 227 ms | 150 ms |
| tokenizer attached to editor | 166 ms | 171 ms | 179 ms | 248 ms | — |
| tabs opened | 150 ms | 157 ms | 166 ms | 234 ms | 165 ms |
| built-in extensions registered | 284 ms | 289 ms | 299 ms | 346 ms | 217 ms |
| frame with file text | 166 ms | 169 ms | 177 ms | 246 ms | 177 ms |
| frame with highlighting | 255 ms | 261 ms | 272 ms | 320 ms | — |
| extension host up | 492 ms | 546 ms | 601 ms | 965 ms | 379 ms |
| startup complete | 273 ms | 280 ms | 289 ms | 336 ms | 206 ms |
| to text (black box) | 167 ms | 171 ms | 179 ms | 246 ms | 177 ms |
| to highlight (black box) | 255 ms | 261 ms | 272 ms | 320 ms | — |
| gap black − white (text) | 3 ms | 2 ms | 2 ms | 1 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 36 ms | 13 ms | 9 ms | 10 ms | — | 6 ms | 3 ms |
| `medium` failed | 30 ms | 16 ms | 10 ms | 10 ms | — | 7 ms | 5 ms |
| `large` failed | 27 ms | 25 ms | 24 ms | 17 ms | — | 12 ms | 17 ms |
| `xlarge` failed | 36 ms | 36 ms | 16 ms | 21 ms | — | 11 ms | 60 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
