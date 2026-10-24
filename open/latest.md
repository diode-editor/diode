# File open benchmark

- Recorded: 2026-10-24T16:34:05.184Z, commit `967045bc271b`, diode nightly-967045b
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 22 ms; binary floor (`diode --version` over PTY, median): 54 ms; for reference `node --version`: 5 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **113 ms** | 82 ms | 135 ms | 233 ms | 10 ms | 246 MB | 11 |
| `medium` | 126.7 KB | 2000 | **122 ms** | 90 ms | 144 ms | 241 ms | 4 ms | 268 MB | 11 |
| `large` | 1.3 MB | 20000 | **138 ms** | 107 ms | 161 ms | 256 ms | 9 ms | 289 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **218 ms** | 186 ms | 240 ms | 322 ms | 21 ms | 358 MB | 5 |
| `log500m` | 497 MB | 5295839 | **129 ms** | 97 ms | 151 ms | — (plaintext) | 1 ms | 296 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 7 ms | 9 ms | 5 ms |
| node ready (bootstrapComplete) | 60 ms | 62 ms | 65 ms | 83 ms | 56 ms |
| bundle executed (main:start) | 60 ms | 62 ms | 65 ms | 83 ms | 56 ms |
| config loaded | 76 ms | 82 ms | 83 ms | 97 ms | 77 ms |
| keybindings loaded | 76 ms | 82 ms | 83 ms | 97 ms | 77 ms |
| session state loaded | 76 ms | 83 ms | 83 ms | 97 ms | 77 ms |
| extensions scanned | 74 ms | 79 ms | 81 ms | 94 ms | 75 ms |
| themes ready | 79 ms | 85 ms | 87 ms | 102 ms | 79 ms |
| DI container created | 84 ms | 88 ms | 91 ms | 106 ms | 84 ms |
| workbench mounted | 106 ms | 112 ms | 113 ms | 132 ms | 107 ms |
| first frame | 106 ms | 112 ms | 113 ms | 132 ms | 107 ms |
| workbench activated | 111 ms | 117 ms | 117 ms | 138 ms | 112 ms |
| grammars preloaded | 116 ms | 122 ms | 123 ms | 142 ms | 115 ms |
| file read from disk | 118 ms | 125 ms | 137 ms | 219 ms | 124 ms |
| file decoded | 118 ms | 125 ms | 137 ms | 219 ms | 124 ms |
| document built | 118 ms | 126 ms | 139 ms | 219 ms | 124 ms |
| tokenizer attached to editor | 135 ms | 145 ms | 161 ms | 241 ms | — |
| tabs opened | 121 ms | 131 ms | 147 ms | 228 ms | 140 ms |
| built-in extensions registered | 248 ms | 257 ms | 272 ms | 336 ms | 182 ms |
| frame with file text | 134 ms | 143 ms | 158 ms | 240 ms | 151 ms |
| frame with highlighting | 233 ms | 240 ms | 256 ms | 321 ms | — |
| extension host up | 441 ms | 462 ms | 526 ms | 833 ms | 337 ms |
| startup complete | 244 ms | 254 ms | 269 ms | 333 ms | 177 ms |
| to text (black box) | 135 ms | 144 ms | 161 ms | 240 ms | 151 ms |
| to highlight (black box) | 233 ms | 241 ms | 256 ms | 322 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 30 ms | 10 ms | 9 ms | 9 ms | 14 ms | 7 ms | 2 ms |
| `medium` | 26 ms | 13 ms | 10 ms | 9 ms | 19 ms | 4 ms | 5 ms |
| `large` | 28 ms | 21 ms | 17 ms | 19 ms | 39 ms | 12 ms | 13 ms |
| `xlarge` | 25 ms | 21 ms | 15 ms | 19 ms | 111 ms | 11 ms | 63 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
