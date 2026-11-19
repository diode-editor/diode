# File open benchmark

- Recorded: 2026-11-19T02:31:31.969Z, commit `18f808cf9d63`, diode nightly-18f808c
- Machine: AMD EPYC 9V45 96-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 21 ms; binary floor (`diode --version` over PTY, median): 59 ms; for reference `node --version`: 5 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **137 ms** | 99 ms | 158 ms | 238 ms | 7 ms | 285 MB | 11 |
| `medium` | 126.7 KB | 2000 | **137 ms** | 99 ms | 158 ms | 242 ms | 6 ms | 302 MB | 11 |
| `large` | 1.3 MB | 20000 | **147 ms** | 109 ms | 168 ms | 252 ms | 3 ms | 315 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **213 ms** | 175 ms | 234 ms | 305 ms | 15 ms | 371 MB | 5 |
| `log500m` | 497 MB | 5295839 | **145 ms** | 107 ms | 166 ms | — (plaintext) | 2 ms | 340 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 8 ms | 9 ms | 5 ms |
| node ready (bootstrapComplete) | 64 ms | 63 ms | 69 ms | 75 ms | 58 ms |
| bundle executed (main:start) | 64 ms | 63 ms | 69 ms | 75 ms | 58 ms |
| config loaded | 82 ms | 84 ms | 88 ms | 98 ms | 81 ms |
| keybindings loaded | 84 ms | 84 ms | 88 ms | 98 ms | 81 ms |
| session state loaded | 84 ms | 84 ms | 89 ms | 98 ms | 81 ms |
| extensions scanned | 78 ms | 79 ms | 83 ms | 91 ms | 72 ms |
| themes ready | 87 ms | 88 ms | 94 ms | 101 ms | 84 ms |
| DI container created | 90 ms | 91 ms | 97 ms | 105 ms | 87 ms |
| workbench mounted | 123 ms | 122 ms | 127 ms | 139 ms | 120 ms |
| first frame | 123 ms | 122 ms | 127 ms | 139 ms | 120 ms |
| workbench activated | 131 ms | 128 ms | 133 ms | 146 ms | 127 ms |
| grammars preloaded | 139 ms | 132 ms | 139 ms | 149 ms | 129 ms |
| file read from disk | 141 ms | 136 ms | 148 ms | 210 ms | 138 ms |
| file decoded | 141 ms | 136 ms | 148 ms | 211 ms | 138 ms |
| document built | 141 ms | 137 ms | 149 ms | 211 ms | 138 ms |
| tokenizer attached to editor | 157 ms | 155 ms | 168 ms | 234 ms | — |
| tabs opened | 144 ms | 142 ms | 155 ms | 219 ms | 153 ms |
| built-in extensions registered | 267 ms | 268 ms | 279 ms | 332 ms | 207 ms |
| frame with file text | 156 ms | 153 ms | 167 ms | 233 ms | 166 ms |
| frame with highlighting | 238 ms | 242 ms | 252 ms | 305 ms | — |
| extension host up | 457 ms | 492 ms | 552 ms | 896 ms | 358 ms |
| startup complete | 256 ms | 259 ms | 269 ms | 323 ms | 196 ms |
| to text (black box) | 158 ms | 158 ms | 168 ms | 234 ms | 166 ms |
| to highlight (black box) | 238 ms | 242 ms | 252 ms | 305 ms | — |
| gap black − white (text) | 2 ms | 3 ms | 1 ms | 1 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 32 ms | 12 ms | 11 ms | 8 ms | — | 5 ms | 3 ms |
| `medium` failed | 24 ms | 15 ms | 13 ms | 11 ms | — | 7 ms | 4 ms |
| `large` failed | 43 ms | 25 ms | 28 ms | 23 ms | — | 13 ms | 16 ms |
| `xlarge` failed | 29 ms | 26 ms | 25 ms | 27 ms | — | 10 ms | 43 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
