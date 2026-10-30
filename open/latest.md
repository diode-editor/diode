# File open benchmark

- Recorded: 2026-10-30T02:05:57.632Z, commit `2d113f6bff33`, diode nightly-2d113f6
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 21 ms; binary floor (`diode --version` over PTY, median): 52 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **109 ms** | 78 ms | 130 ms | 218 ms | 5 ms | 259 MB | 11 |
| `medium` | 126.7 KB | 2000 | **117 ms** | 86 ms | 138 ms | 232 ms | 9 ms | 279 MB | 11 |
| `large` | 1.3 MB | 20000 | **120 ms** | 89 ms | 141 ms | 243 ms | 5 ms | 301 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **189 ms** | 159 ms | 211 ms | 313 ms | 10 ms | 366 MB | 5 |
| `log500m` | 497 MB | 5295839 | **123 ms** | 92 ms | 144 ms | — (plaintext) | 5 ms | 270 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 6 ms | 5 ms | 10 ms | 5 ms |
| node ready (bootstrapComplete) | 56 ms | 57 ms | 54 ms | 65 ms | 53 ms |
| bundle executed (main:start) | 56 ms | 57 ms | 54 ms | 65 ms | 53 ms |
| config loaded | 72 ms | 73 ms | 70 ms | 81 ms | 66 ms |
| keybindings loaded | 72 ms | 73 ms | 72 ms | 81 ms | 66 ms |
| session state loaded | 73 ms | 73 ms | 72 ms | 81 ms | 66 ms |
| extensions scanned | 69 ms | 71 ms | 66 ms | 76 ms | 64 ms |
| themes ready | 76 ms | 78 ms | 74 ms | 84 ms | 70 ms |
| DI container created | 79 ms | 81 ms | 77 ms | 87 ms | 74 ms |
| workbench mounted | 102 ms | 105 ms | 101 ms | 110 ms | 99 ms |
| first frame | 102 ms | 105 ms | 101 ms | 110 ms | 99 ms |
| workbench activated | 106 ms | 109 ms | 105 ms | 114 ms | 102 ms |
| grammars preloaded | 113 ms | 116 ms | 114 ms | 122 ms | 108 ms |
| file read from disk | 115 ms | 119 ms | 123 ms | 190 ms | 117 ms |
| file decoded | 115 ms | 119 ms | 123 ms | 190 ms | 117 ms |
| document built | 115 ms | 119 ms | 123 ms | 190 ms | 117 ms |
| tokenizer attached to editor | 131 ms | 142 ms | 157 ms | 225 ms | — |
| tabs opened | 118 ms | 124 ms | 129 ms | 197 ms | 130 ms |
| built-in extensions registered | 238 ms | 252 ms | 260 ms | 331 ms | 171 ms |
| frame with file text | 130 ms | 136 ms | 140 ms | 208 ms | 141 ms |
| frame with highlighting | 218 ms | 232 ms | 243 ms | 313 ms | — |
| extension host up | 425 ms | 461 ms | 505 ms | 861 ms | 317 ms |
| startup complete | 233 ms | 246 ms | 255 ms | 326 ms | 165 ms |
| to text (black box) | 130 ms | 138 ms | 141 ms | 211 ms | 144 ms |
| to highlight (black box) | 218 ms | 232 ms | 243 ms | 313 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 1 ms | 1 ms | 2 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 24 ms | 10 ms | 8 ms | 8 ms | 15 ms | 11 ms | 3 ms |
| `medium` | 27 ms | 9 ms | 10 ms | 9 ms | 13 ms | 7 ms | 3 ms |
| `large` | 34 ms | 20 ms | 14 ms | 15 ms | 42 ms | 14 ms | 12 ms |
| `xlarge` | 24 ms | 21 ms | 14 ms | 13 ms | 148 ms | 15 ms | 51 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
