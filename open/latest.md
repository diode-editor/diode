# File open benchmark

- Recorded: 2026-10-31T22:15:55.447Z, commit `c5414e51d84a`, diode nightly-c5414e5
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 20 ms; binary floor (`diode --version` over PTY, median): 54 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **115 ms** | 81 ms | 135 ms | 224 ms | 5 ms | 261 MB | 11 |
| `medium` | 126.7 KB | 2000 | **118 ms** | 85 ms | 138 ms | 230 ms | 6 ms | 281 MB | 11 |
| `large` | 1.3 MB | 20000 | **131 ms** | 98 ms | 152 ms | 255 ms | 6 ms | 297 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **199 ms** | 166 ms | 220 ms | 326 ms | 2 ms | 373 MB | 5 |
| `log500m` | 497 MB | 5295839 | **129 ms** | 96 ms | 149 ms | — (plaintext) | 10 ms | 306 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 6 ms | 10 ms | 5 ms |
| node ready (bootstrapComplete) | 58 ms | 58 ms | 61 ms | 77 ms | 54 ms |
| bundle executed (main:start) | 58 ms | 58 ms | 61 ms | 77 ms | 54 ms |
| config loaded | 75 ms | 71 ms | 75 ms | 97 ms | 74 ms |
| keybindings loaded | 75 ms | 73 ms | 77 ms | 97 ms | 74 ms |
| session state loaded | 75 ms | 73 ms | 77 ms | 97 ms | 74 ms |
| extensions scanned | 73 ms | 68 ms | 72 ms | 92 ms | 72 ms |
| themes ready | 79 ms | 76 ms | 80 ms | 100 ms | 77 ms |
| DI container created | 82 ms | 80 ms | 83 ms | 102 ms | 79 ms |
| workbench mounted | 106 ms | 105 ms | 111 ms | 125 ms | 105 ms |
| first frame | 106 ms | 105 ms | 111 ms | 125 ms | 105 ms |
| workbench activated | 110 ms | 109 ms | 115 ms | 129 ms | 109 ms |
| grammars preloaded | 116 ms | 116 ms | 124 ms | 137 ms | 115 ms |
| file read from disk | 117 ms | 119 ms | 134 ms | 198 ms | 123 ms |
| file decoded | 118 ms | 119 ms | 134 ms | 198 ms | 123 ms |
| document built | 118 ms | 119 ms | 134 ms | 199 ms | 123 ms |
| tokenizer attached to editor | 133 ms | 141 ms | 167 ms | 235 ms | — |
| tabs opened | 121 ms | 124 ms | 140 ms | 206 ms | 138 ms |
| built-in extensions registered | 244 ms | 251 ms | 273 ms | 345 ms | 183 ms |
| frame with file text | 132 ms | 135 ms | 150 ms | 219 ms | 149 ms |
| frame with highlighting | 223 ms | 230 ms | 255 ms | 326 ms | — |
| extension host up | 426 ms | 462 ms | 523 ms | 898 ms | 334 ms |
| startup complete | 239 ms | 246 ms | 269 ms | 340 ms | 176 ms |
| to text (black box) | 135 ms | 138 ms | 152 ms | 220 ms | 149 ms |
| to highlight (black box) | 224 ms | 230 ms | 255 ms | 326 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 1 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 28 ms | 9 ms | 8 ms | 9 ms | 13 ms | 9 ms | 3 ms |
| `medium` | 26 ms | 13 ms | 10 ms | 7 ms | 14 ms | 5 ms | 4 ms |
| `large` | 29 ms | 17 ms | 21 ms | 11 ms | 37 ms | 13 ms | 15 ms |
| `xlarge` | 21 ms | 27 ms | 17 ms | 23 ms | 119 ms | 8 ms | 59 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
