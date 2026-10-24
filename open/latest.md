# File open benchmark

- Recorded: 2026-10-24T16:19:43.400Z, commit `669abcb37138`, diode nightly-669abcb
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 26 ms; binary floor (`diode --version` over PTY, median): 63 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **130 ms** | 92 ms | 155 ms | 272 ms | 18 ms | 248 MB | 11 |
| `medium` | 126.7 KB | 2000 | **138 ms** | 101 ms | 164 ms | 276 ms | 8 ms | 264 MB | 11 |
| `large` | 1.3 MB | 20000 | **151 ms** | 114 ms | 177 ms | 287 ms | 4 ms | 290 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **239 ms** | 202 ms | 265 ms | 363 ms | 13 ms | 351 MB | 5 |
| `log500m` | 497 MB | 5295839 | **145 ms** | 108 ms | 171 ms | — (plaintext) | 6 ms | 262 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 7 ms | 9 ms | 6 ms |
| node ready (bootstrapComplete) | 68 ms | 68 ms | 71 ms | 82 ms | 64 ms |
| bundle executed (main:start) | 68 ms | 68 ms | 71 ms | 82 ms | 64 ms |
| config loaded | 89 ms | 89 ms | 88 ms | 100 ms | 78 ms |
| keybindings loaded | 90 ms | 89 ms | 88 ms | 100 ms | 79 ms |
| session state loaded | 90 ms | 90 ms | 88 ms | 100 ms | 79 ms |
| extensions scanned | 85 ms | 85 ms | 85 ms | 95 ms | 75 ms |
| themes ready | 92 ms | 92 ms | 93 ms | 102 ms | 83 ms |
| DI container created | 98 ms | 96 ms | 97 ms | 106 ms | 88 ms |
| workbench mounted | 125 ms | 124 ms | 127 ms | 136 ms | 118 ms |
| first frame | 125 ms | 124 ms | 127 ms | 136 ms | 118 ms |
| workbench activated | 130 ms | 129 ms | 132 ms | 140 ms | 123 ms |
| grammars preloaded | 135 ms | 135 ms | 142 ms | 151 ms | 130 ms |
| file read from disk | 137 ms | 137 ms | 153 ms | 240 ms | 143 ms |
| file decoded | 137 ms | 137 ms | 153 ms | 240 ms | 143 ms |
| document built | 137 ms | 138 ms | 153 ms | 240 ms | 143 ms |
| tokenizer attached to editor | 155 ms | 163 ms | 176 ms | 267 ms | — |
| tabs opened | 141 ms | 144 ms | 162 ms | 250 ms | 160 ms |
| built-in extensions registered | 291 ms | 295 ms | 306 ms | 381 ms | 201 ms |
| frame with file text | 154 ms | 161 ms | 174 ms | 265 ms | 171 ms |
| frame with highlighting | 271 ms | 276 ms | 287 ms | 363 ms | — |
| extension host up | 511 ms | 530 ms | 604 ms | 924 ms | 374 ms |
| startup complete | 286 ms | 290 ms | 301 ms | 376 ms | 197 ms |
| to text (black box) | 155 ms | 164 ms | 177 ms | 265 ms | 171 ms |
| to highlight (black box) | 272 ms | 276 ms | 287 ms | 363 ms | — |
| gap black − white (text) | 1 ms | 3 ms | 3 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 34 ms | 11 ms | 12 ms | 11 ms | 18 ms | 7 ms | 3 ms |
| `medium` | 34 ms | 9 ms | 9 ms | 8 ms | 14 ms | 6 ms | 5 ms |
| `large` | 46 ms | 21 ms | 16 ms | 16 ms | 39 ms | 15 ms | 15 ms |
| `xlarge` | 26 ms | 18 ms | 10 ms | 12 ms | 93 ms | 8 ms | 68 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
