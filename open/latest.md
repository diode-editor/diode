# File open benchmark

- Recorded: 2026-11-17T19:43:35.511Z, commit `ff954a556956`, diode nightly-ff954a5
- Machine: Intel(R) Xeon(R) 6975P-C (4 cores, 15 GB), linux 7.0.0-1016-aws
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 16 ms; binary floor (`diode --version` over PTY, median): 53 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **126 ms** | 90 ms | 143 ms | 225 ms | 7 ms | 275 MB | 11 |
| `medium` | 126.7 KB | 2000 | **126 ms** | 89 ms | 142 ms | 225 ms | 3 ms | 294 MB | 11 |
| `large` | 1.3 MB | 20000 | **139 ms** | 102 ms | 155 ms | 237 ms | 5 ms | 309 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **198 ms** | 161 ms | 214 ms | 287 ms | 5 ms | 362 MB | 5 |
| `log500m` | 497 MB | 5295839 | **135 ms** | 99 ms | 152 ms | — (plaintext) | 6 ms | 286 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 4 ms | 6 ms | 7 ms | 4 ms |
| node ready (bootstrapComplete) | 56 ms | 56 ms | 59 ms | 71 ms | 56 ms |
| bundle executed (main:start) | 56 ms | 57 ms | 59 ms | 71 ms | 56 ms |
| config loaded | 72 ms | 70 ms | 74 ms | 87 ms | 69 ms |
| keybindings loaded | 72 ms | 70 ms | 74 ms | 87 ms | 70 ms |
| session state loaded | 72 ms | 70 ms | 74 ms | 87 ms | 70 ms |
| extensions scanned | 69 ms | 67 ms | 69 ms | 83 ms | 66 ms |
| themes ready | 77 ms | 74 ms | 78 ms | 91 ms | 74 ms |
| DI container created | 80 ms | 77 ms | 81 ms | 94 ms | 77 ms |
| workbench mounted | 110 ms | 108 ms | 111 ms | 122 ms | 109 ms |
| first frame | 110 ms | 108 ms | 111 ms | 122 ms | 109 ms |
| workbench activated | 116 ms | 113 ms | 118 ms | 128 ms | 116 ms |
| grammars preloaded | 125 ms | 122 ms | 128 ms | 131 ms | 122 ms |
| file read from disk | 127 ms | 125 ms | 137 ms | 194 ms | 129 ms |
| file decoded | 127 ms | 125 ms | 137 ms | 195 ms | 129 ms |
| document built | 127 ms | 125 ms | 137 ms | 195 ms | 129 ms |
| tokenizer attached to editor | 142 ms | 142 ms | 157 ms | 215 ms | — |
| tabs opened | 131 ms | 130 ms | 143 ms | 202 ms | 141 ms |
| built-in extensions registered | 242 ms | 244 ms | 259 ms | 303 ms | 183 ms |
| frame with file text | 141 ms | 140 ms | 155 ms | 213 ms | 152 ms |
| frame with highlighting | 225 ms | 225 ms | 237 ms | 287 ms | — |
| extension host up | 421 ms | 436 ms | 520 ms | 864 ms | 321 ms |
| startup complete | 236 ms | 236 ms | 249 ms | 297 ms | 174 ms |
| to text (black box) | 143 ms | 142 ms | 155 ms | 214 ms | 152 ms |
| to highlight (black box) | 225 ms | 225 ms | 237 ms | 287 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 1 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 26 ms | 9 ms | 9 ms | 7 ms | — | 4 ms | 3 ms |
| `medium` failed | 23 ms | 12 ms | 10 ms | 5 ms | — | 5 ms | 4 ms |
| `large` failed | 32 ms | 25 ms | 20 ms | 20 ms | — | 16 ms | 15 ms |
| `xlarge` failed | 38 ms | 35 ms | 19 ms | 25 ms | — | 11 ms | 69 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
