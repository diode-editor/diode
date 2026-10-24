# File open benchmark

- Recorded: 2026-10-24T15:33:20.832Z, commit `cfdc75ad83a4`, diode nightly-cfdc75a
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 26 ms; binary floor (`diode --version` over PTY, median): 62 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **139 ms** | 104 ms | 165 ms | 279 ms | 11 ms | 243 MB | 11 |
| `medium` | 126.7 KB | 2000 | **143 ms** | 107 ms | 169 ms | 288 ms | 19 ms | 267 MB | 11 |
| `large` | 1.3 MB | 20000 | **153 ms** | 118 ms | 180 ms | 297 ms | 9 ms | 286 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **243 ms** | 208 ms | 269 ms | 367 ms | 3 ms | 352 MB | 5 |
| `log500m` | 497 MB | 5295839 | **147 ms** | 112 ms | 173 ms | — (plaintext) | 2 ms | 291 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 7 ms | 8 ms | 6 ms |
| node ready (bootstrapComplete) | 65 ms | 71 ms | 68 ms | 79 ms | 60 ms |
| bundle executed (main:start) | 65 ms | 71 ms | 68 ms | 79 ms | 60 ms |
| config loaded | 84 ms | 89 ms | 87 ms | 94 ms | 77 ms |
| keybindings loaded | 84 ms | 90 ms | 88 ms | 96 ms | 82 ms |
| session state loaded | 85 ms | 90 ms | 88 ms | 96 ms | 82 ms |
| extensions scanned | 80 ms | 85 ms | 83 ms | 91 ms | 74 ms |
| themes ready | 88 ms | 94 ms | 91 ms | 101 ms | 85 ms |
| DI container created | 93 ms | 98 ms | 96 ms | 105 ms | 88 ms |
| workbench mounted | 125 ms | 132 ms | 123 ms | 137 ms | 117 ms |
| first frame | 125 ms | 132 ms | 123 ms | 137 ms | 117 ms |
| workbench activated | 130 ms | 137 ms | 129 ms | 143 ms | 122 ms |
| grammars preloaded | 141 ms | 142 ms | 138 ms | 153 ms | 125 ms |
| file read from disk | 143 ms | 146 ms | 155 ms | 247 ms | 140 ms |
| file decoded | 143 ms | 146 ms | 155 ms | 247 ms | 140 ms |
| document built | 144 ms | 146 ms | 156 ms | 247 ms | 140 ms |
| tokenizer attached to editor | 163 ms | 171 ms | 179 ms | 270 ms | — |
| tabs opened | 147 ms | 152 ms | 165 ms | 256 ms | 160 ms |
| built-in extensions registered | 299 ms | 307 ms | 316 ms | 386 ms | 207 ms |
| frame with file text | 162 ms | 169 ms | 178 ms | 269 ms | 173 ms |
| frame with highlighting | 279 ms | 287 ms | 296 ms | 367 ms | — |
| extension host up | 529 ms | 548 ms | 621 ms | 935 ms | 383 ms |
| startup complete | 294 ms | 303 ms | 312 ms | 382 ms | 201 ms |
| to text (black box) | 165 ms | 169 ms | 180 ms | 269 ms | 173 ms |
| to highlight (black box) | 279 ms | 288 ms | 297 ms | 367 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 1 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 36 ms | 11 ms | 9 ms | 13 ms | 14 ms | 7 ms | 3 ms |
| `medium` | 37 ms | 11 ms | 12 ms | 10 ms | 13 ms | 7 ms | 9 ms |
| `large` | 36 ms | 18 ms | 15 ms | 17 ms | 40 ms | 13 ms | 15 ms |
| `xlarge` | 30 ms | 17 ms | 10 ms | 10 ms | 97 ms | 11 ms | 81 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
