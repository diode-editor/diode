# File open benchmark

- Recorded: 2026-11-01T14:55:25.044Z, commit `9ee0f8d392cc`, diode nightly-9ee0f8d
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 24 ms; binary floor (`diode --version` over PTY, median): 62 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **143 ms** | 105 ms | 167 ms | 276 ms | 6 ms | 256 MB | 11 |
| `medium` | 126.7 KB | 2000 | **143 ms** | 105 ms | 167 ms | 282 ms | 6 ms | 280 MB | 11 |
| `large` | 1.3 MB | 20000 | **159 ms** | 121 ms | 184 ms | 312 ms | 8 ms | 293 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **251 ms** | 213 ms | 276 ms | 401 ms | 10 ms | 370 MB | 5 |
| `log500m` | 497 MB | 5295839 | **154 ms** | 116 ms | 178 ms | — (plaintext) | 16 ms | 303 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 7 ms | 8 ms | 6 ms |
| node ready (bootstrapComplete) | 67 ms | 66 ms | 67 ms | 84 ms | 63 ms |
| bundle executed (main:start) | 67 ms | 66 ms | 67 ms | 84 ms | 63 ms |
| config loaded | 85 ms | 87 ms | 86 ms | 107 ms | 86 ms |
| keybindings loaded | 87 ms | 87 ms | 87 ms | 107 ms | 86 ms |
| session state loaded | 87 ms | 87 ms | 87 ms | 107 ms | 87 ms |
| extensions scanned | 82 ms | 82 ms | 82 ms | 101 ms | 82 ms |
| themes ready | 91 ms | 91 ms | 92 ms | 110 ms | 90 ms |
| DI container created | 95 ms | 95 ms | 96 ms | 114 ms | 93 ms |
| workbench mounted | 130 ms | 125 ms | 131 ms | 144 ms | 123 ms |
| first frame | 130 ms | 125 ms | 131 ms | 144 ms | 123 ms |
| workbench activated | 136 ms | 134 ms | 138 ms | 149 ms | 128 ms |
| grammars preloaded | 146 ms | 140 ms | 146 ms | 154 ms | 130 ms |
| file read from disk | 148 ms | 144 ms | 159 ms | 248 ms | 143 ms |
| file decoded | 148 ms | 144 ms | 159 ms | 248 ms | 143 ms |
| document built | 148 ms | 144 ms | 159 ms | 249 ms | 143 ms |
| tokenizer attached to editor | 168 ms | 173 ms | 200 ms | 289 ms | — |
| tabs opened | 152 ms | 151 ms | 169 ms | 257 ms | 163 ms |
| built-in extensions registered | 306 ms | 307 ms | 335 ms | 423 ms | 221 ms |
| frame with file text | 166 ms | 165 ms | 183 ms | 272 ms | 178 ms |
| frame with highlighting | 276 ms | 281 ms | 312 ms | 401 ms | — |
| extension host up | 543 ms | 581 ms | 652 ms | 1089 ms | 394 ms |
| startup complete | 299 ms | 301 ms | 329 ms | 418 ms | 213 ms |
| to text (black box) | 167 ms | 167 ms | 184 ms | 276 ms | 178 ms |
| to highlight (black box) | 276 ms | 282 ms | 312 ms | 401 ms | — |
| gap black − white (text) | 2 ms | 1 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 30 ms | 14 ms | 12 ms | 9 ms | 25 ms | 10 ms | 3 ms |
| `medium` | 32 ms | 13 ms | 10 ms | 10 ms | 23 ms | 7 ms | 5 ms |
| `large` | 38 ms | 24 ms | 22 ms | 19 ms | 47 ms | 13 ms | 18 ms |
| `xlarge` | 34 ms | 38 ms | 22 ms | 25 ms | 141 ms | 16 ms | 71 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
