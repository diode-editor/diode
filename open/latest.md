# File open benchmark

- Recorded: 2026-11-01T09:38:53.307Z, commit `b05efb1f9056`, diode nightly-b05efb1
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 24 ms; binary floor (`diode --version` over PTY, median): 62 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **138 ms** | 100 ms | 162 ms | 279 ms | 9 ms | 270 MB | 11 |
| `medium` | 126.7 KB | 2000 | **145 ms** | 108 ms | 169 ms | 290 ms | 10 ms | 280 MB | 11 |
| `large` | 1.3 MB | 20000 | **159 ms** | 121 ms | 183 ms | 312 ms | 4 ms | 297 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **252 ms** | 214 ms | 276 ms | 405 ms | 13 ms | 361 MB | 5 |
| `log500m` | 497 MB | 5295839 | **155 ms** | 117 ms | 179 ms | — (plaintext) | 2 ms | 304 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 6 ms | 6 ms | 8 ms | 6 ms |
| node ready (bootstrapComplete) | 67 ms | 65 ms | 69 ms | 83 ms | 65 ms |
| bundle executed (main:start) | 67 ms | 65 ms | 69 ms | 83 ms | 65 ms |
| config loaded | 84 ms | 87 ms | 87 ms | 106 ms | 88 ms |
| keybindings loaded | 85 ms | 87 ms | 88 ms | 106 ms | 88 ms |
| session state loaded | 86 ms | 87 ms | 88 ms | 106 ms | 89 ms |
| extensions scanned | 81 ms | 82 ms | 83 ms | 103 ms | 83 ms |
| themes ready | 90 ms | 91 ms | 92 ms | 109 ms | 91 ms |
| DI container created | 94 ms | 94 ms | 97 ms | 113 ms | 95 ms |
| workbench mounted | 126 ms | 127 ms | 129 ms | 141 ms | 124 ms |
| first frame | 126 ms | 127 ms | 129 ms | 141 ms | 124 ms |
| workbench activated | 132 ms | 132 ms | 137 ms | 151 ms | 129 ms |
| grammars preloaded | 138 ms | 142 ms | 143 ms | 157 ms | 132 ms |
| file read from disk | 140 ms | 146 ms | 158 ms | 253 ms | 147 ms |
| file decoded | 140 ms | 146 ms | 158 ms | 253 ms | 147 ms |
| document built | 141 ms | 146 ms | 158 ms | 253 ms | 147 ms |
| tokenizer attached to editor | 163 ms | 175 ms | 197 ms | 293 ms | — |
| tabs opened | 145 ms | 153 ms | 166 ms | 262 ms | 165 ms |
| built-in extensions registered | 305 ms | 314 ms | 335 ms | 428 ms | 221 ms |
| frame with file text | 160 ms | 168 ms | 180 ms | 276 ms | 179 ms |
| frame with highlighting | 277 ms | 289 ms | 312 ms | 405 ms | — |
| extension host up | 546 ms | 588 ms | 648 ms | 1088 ms | 395 ms |
| startup complete | 298 ms | 309 ms | 329 ms | 422 ms | 212 ms |
| to text (black box) | 162 ms | 169 ms | 183 ms | 276 ms | 179 ms |
| to highlight (black box) | 279 ms | 290 ms | 312 ms | 405 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 34 ms | 13 ms | 9 ms | 11 ms | 21 ms | 8 ms | 3 ms |
| `medium` | 38 ms | 14 ms | 12 ms | 11 ms | 21 ms | 9 ms | 6 ms |
| `large` | 40 ms | 20 ms | 18 ms | 15 ms | 38 ms | 14 ms | 14 ms |
| `xlarge` | 30 ms | 23 ms | 12 ms | 19 ms | 104 ms | 13 ms | 71 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
