# File open benchmark

- Recorded: 2026-11-01T12:43:50.059Z, commit `03d2850846ef`, diode nightly-03d2850
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 24 ms; binary floor (`diode --version` over PTY, median): 63 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **147 ms** | 108 ms | 171 ms | 288 ms | 8 ms | 256 MB | 11 |
| `medium` | 126.7 KB | 2000 | **143 ms** | 104 ms | 167 ms | 284 ms | 5 ms | 280 MB | 11 |
| `large` | 1.3 MB | 20000 | **160 ms** | 121 ms | 184 ms | 320 ms | 7 ms | 291 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **239 ms** | 200 ms | 263 ms | 394 ms | 13 ms | 366 MB | 5 |
| `log500m` | 497 MB | 5295839 | **166 ms** | 127 ms | 190 ms | — (plaintext) | 4 ms | 273 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 7 ms | 9 ms | 5 ms |
| node ready (bootstrapComplete) | 66 ms | 67 ms | 70 ms | 77 ms | 64 ms |
| bundle executed (main:start) | 66 ms | 67 ms | 70 ms | 77 ms | 64 ms |
| config loaded | 86 ms | 87 ms | 87 ms | 98 ms | 83 ms |
| keybindings loaded | 88 ms | 89 ms | 90 ms | 98 ms | 83 ms |
| session state loaded | 88 ms | 89 ms | 90 ms | 99 ms | 83 ms |
| extensions scanned | 82 ms | 83 ms | 83 ms | 94 ms | 79 ms |
| themes ready | 92 ms | 93 ms | 93 ms | 103 ms | 89 ms |
| DI container created | 96 ms | 96 ms | 97 ms | 107 ms | 93 ms |
| workbench mounted | 130 ms | 127 ms | 130 ms | 138 ms | 128 ms |
| first frame | 130 ms | 127 ms | 130 ms | 138 ms | 128 ms |
| workbench activated | 139 ms | 131 ms | 140 ms | 148 ms | 140 ms |
| grammars preloaded | 144 ms | 138 ms | 146 ms | 154 ms | 142 ms |
| file read from disk | 147 ms | 142 ms | 158 ms | 239 ms | 154 ms |
| file decoded | 147 ms | 142 ms | 158 ms | 239 ms | 154 ms |
| document built | 147 ms | 142 ms | 158 ms | 239 ms | 154 ms |
| tokenizer attached to editor | 171 ms | 174 ms | 200 ms | 280 ms | — |
| tabs opened | 152 ms | 149 ms | 168 ms | 249 ms | 175 ms |
| built-in extensions registered | 312 ms | 310 ms | 342 ms | 416 ms | 234 ms |
| frame with file text | 169 ms | 166 ms | 183 ms | 263 ms | 190 ms |
| frame with highlighting | 288 ms | 284 ms | 319 ms | 394 ms | — |
| extension host up | 552 ms | 593 ms | 648 ms | 1091 ms | 419 ms |
| startup complete | 306 ms | 304 ms | 336 ms | 410 ms | 227 ms |
| to text (black box) | 171 ms | 167 ms | 184 ms | 263 ms | 190 ms |
| to highlight (black box) | 288 ms | 284 ms | 320 ms | 394 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 34 ms | 13 ms | 12 ms | 11 ms | 19 ms | 8 ms | 3 ms |
| `medium` | 38 ms | 16 ms | 11 ms | 9 ms | 19 ms | 6 ms | 5 ms |
| `large` | 41 ms | 20 ms | 25 ms | 20 ms | 38 ms | 13 ms | 17 ms |
| `xlarge` | 29 ms | 32 ms | 18 ms | 23 ms | 126 ms | 18 ms | 82 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
