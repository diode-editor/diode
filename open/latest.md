# File open benchmark

- Recorded: 2026-11-19T09:17:21.900Z, commit `d0b90f099dc2`, diode nightly-d0b90f0
- Machine: Intel(R) Xeon(R) 6975P-C (4 cores, 15 GB), linux 7.0.0-1016-aws
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 17 ms; binary floor (`diode --version` over PTY, median): 49 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **124 ms** | 92 ms | 141 ms | 223 ms | 7 ms | 293 MB | 11 |
| `medium` | 126.7 KB | 2000 | **121 ms** | 89 ms | 138 ms | 220 ms | 4 ms | 302 MB | 11 |
| `large` | 1.3 MB | 20000 | **135 ms** | 103 ms | 152 ms | 236 ms | 9 ms | 314 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **214 ms** | 183 ms | 232 ms | 303 ms | 17 ms | 367 MB | 5 |
| `log500m` | 497 MB | 5295839 | **136 ms** | 104 ms | 153 ms | — (plaintext) | 2 ms | 342 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 5 ms | 5 ms | 7 ms | 5 ms |
| node ready (bootstrapComplete) | 58 ms | 56 ms | 60 ms | 71 ms | 55 ms |
| bundle executed (main:start) | 58 ms | 56 ms | 60 ms | 71 ms | 55 ms |
| config loaded | 76 ms | 73 ms | 76 ms | 87 ms | 73 ms |
| keybindings loaded | 76 ms | 74 ms | 77 ms | 88 ms | 73 ms |
| session state loaded | 76 ms | 74 ms | 77 ms | 88 ms | 73 ms |
| extensions scanned | 70 ms | 69 ms | 71 ms | 83 ms | 66 ms |
| themes ready | 79 ms | 77 ms | 81 ms | 92 ms | 76 ms |
| DI container created | 81 ms | 80 ms | 84 ms | 95 ms | 78 ms |
| workbench mounted | 110 ms | 107 ms | 117 ms | 128 ms | 111 ms |
| first frame | 110 ms | 107 ms | 117 ms | 128 ms | 111 ms |
| workbench activated | 116 ms | 113 ms | 122 ms | 135 ms | 117 ms |
| grammars preloaded | 124 ms | 118 ms | 125 ms | 144 ms | 121 ms |
| file read from disk | 126 ms | 121 ms | 134 ms | 207 ms | 129 ms |
| file decoded | 126 ms | 121 ms | 134 ms | 207 ms | 129 ms |
| document built | 126 ms | 121 ms | 134 ms | 208 ms | 129 ms |
| tokenizer attached to editor | 141 ms | 139 ms | 153 ms | 230 ms | — |
| tabs opened | 130 ms | 126 ms | 141 ms | 216 ms | 142 ms |
| built-in extensions registered | 244 ms | 241 ms | 259 ms | 324 ms | 185 ms |
| frame with file text | 140 ms | 137 ms | 151 ms | 228 ms | 153 ms |
| frame with highlighting | 223 ms | 219 ms | 236 ms | 303 ms | — |
| extension host up | 414 ms | 441 ms | 535 ms | 895 ms | 322 ms |
| startup complete | 234 ms | 233 ms | 248 ms | 315 ms | 175 ms |
| to text (black box) | 141 ms | 138 ms | 152 ms | 232 ms | 153 ms |
| to highlight (black box) | 223 ms | 220 ms | 236 ms | 303 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 1 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 22 ms | 11 ms | 7 ms | 5 ms | — | 3 ms | 3 ms |
| `medium` failed | 20 ms | 10 ms | 7 ms | 9 ms | — | 4 ms | 4 ms |
| `large` failed | 41 ms | 24 ms | 21 ms | 19 ms | — | 17 ms | 15 ms |
| `xlarge` failed | 34 ms | 21 ms | 19 ms | 19 ms | — | 11 ms | 58 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
