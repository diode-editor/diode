# File open benchmark

- Recorded: 2026-10-31T14:18:58.306Z, commit `8dd171aa44d3`, diode nightly-8dd171a
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 26 ms; binary floor (`diode --version` over PTY, median): 62 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **136 ms** | 100 ms | 161 ms | 275 ms | 6 ms | 261 MB | 11 |
| `medium` | 126.7 KB | 2000 | **134 ms** | 98 ms | 160 ms | 279 ms | 8 ms | 280 MB | 11 |
| `large` | 1.3 MB | 20000 | **154 ms** | 118 ms | 179 ms | 309 ms | 2 ms | 294 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **232 ms** | 197 ms | 258 ms | 385 ms | 28 ms | 364 MB | 5 |
| `log500m` | 497 MB | 5295839 | **158 ms** | 122 ms | 183 ms | — (plaintext) | 3 ms | 270 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 6 ms | 7 ms | 8 ms | 6 ms |
| node ready (bootstrapComplete) | 65 ms | 63 ms | 69 ms | 77 ms | 64 ms |
| bundle executed (main:start) | 65 ms | 63 ms | 69 ms | 77 ms | 64 ms |
| config loaded | 84 ms | 82 ms | 86 ms | 94 ms | 81 ms |
| keybindings loaded | 86 ms | 83 ms | 86 ms | 94 ms | 82 ms |
| session state loaded | 86 ms | 83 ms | 86 ms | 94 ms | 82 ms |
| extensions scanned | 80 ms | 78 ms | 83 ms | 91 ms | 78 ms |
| themes ready | 90 ms | 86 ms | 90 ms | 97 ms | 86 ms |
| DI container created | 93 ms | 90 ms | 94 ms | 101 ms | 90 ms |
| workbench mounted | 125 ms | 123 ms | 127 ms | 135 ms | 125 ms |
| first frame | 125 ms | 123 ms | 127 ms | 135 ms | 125 ms |
| workbench activated | 129 ms | 128 ms | 132 ms | 140 ms | 131 ms |
| grammars preloaded | 138 ms | 135 ms | 142 ms | 150 ms | 138 ms |
| file read from disk | 140 ms | 139 ms | 154 ms | 234 ms | 151 ms |
| file decoded | 140 ms | 139 ms | 154 ms | 235 ms | 151 ms |
| document built | 141 ms | 139 ms | 154 ms | 235 ms | 151 ms |
| tokenizer attached to editor | 161 ms | 166 ms | 195 ms | 275 ms | — |
| tabs opened | 144 ms | 146 ms | 165 ms | 244 ms | 169 ms |
| built-in extensions registered | 302 ms | 306 ms | 333 ms | 407 ms | 227 ms |
| frame with file text | 159 ms | 159 ms | 179 ms | 258 ms | 183 ms |
| frame with highlighting | 275 ms | 279 ms | 309 ms | 385 ms | — |
| extension host up | 534 ms | 573 ms | 643 ms | 1081 ms | 422 ms |
| startup complete | 295 ms | 300 ms | 326 ms | 402 ms | 219 ms |
| to text (black box) | 161 ms | 160 ms | 179 ms | 258 ms | 183 ms |
| to highlight (black box) | 275 ms | 279 ms | 309 ms | 385 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 2 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 33 ms | 11 ms | 10 ms | 10 ms | 13 ms | 6 ms | 4 ms |
| `medium` | 34 ms | 13 ms | 13 ms | 12 ms | 16 ms | 7 ms | 4 ms |
| `large` | 36 ms | 18 ms | 20 ms | 13 ms | 41 ms | 14 ms | 16 ms |
| `xlarge` | 37 ms | 26 ms | 18 ms | 19 ms | 121 ms | 15 ms | 76 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
