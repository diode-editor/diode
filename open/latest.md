# File open benchmark

- Recorded: 2026-11-15T20:49:10.651Z, commit `a79ae2f1513a`, diode nightly-a79ae2f
- Machine: Intel(R) Xeon(R) 6975P-C (4 cores, 15 GB), linux 7.0.0-1016-aws
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 20 ms; binary floor (`diode --version` over PTY, median): 56 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **129 ms** | 93 ms | 149 ms | 238 ms | 5 ms | 272 MB | 11 |
| `medium` | 126.7 KB | 2000 | **132 ms** | 97 ms | 153 ms | 241 ms | 4 ms | 291 MB | 11 |
| `large` | 1.3 MB | 20000 | **140 ms** | 104 ms | 160 ms | 252 ms | 6 ms | 306 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **201 ms** | 165 ms | 221 ms | 298 ms | 6 ms | 357 MB | 5 |
| `log500m` | 497 MB | 5295839 | **136 ms** | 100 ms | 156 ms | — (plaintext) | 6 ms | 315 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 5 ms | 5 ms | 6 ms | 5 ms |
| node ready (bootstrapComplete) | 58 ms | 61 ms | 60 ms | 64 ms | 56 ms |
| bundle executed (main:start) | 58 ms | 61 ms | 60 ms | 64 ms | 56 ms |
| config loaded | 76 ms | 75 ms | 76 ms | 78 ms | 76 ms |
| keybindings loaded | 77 ms | 75 ms | 76 ms | 81 ms | 78 ms |
| session state loaded | 77 ms | 75 ms | 76 ms | 81 ms | 79 ms |
| extensions scanned | 72 ms | 70 ms | 72 ms | 75 ms | 70 ms |
| themes ready | 81 ms | 80 ms | 81 ms | 85 ms | 81 ms |
| DI container created | 84 ms | 83 ms | 84 ms | 88 ms | 84 ms |
| workbench mounted | 115 ms | 115 ms | 115 ms | 116 ms | 113 ms |
| first frame | 115 ms | 115 ms | 115 ms | 116 ms | 113 ms |
| workbench activated | 122 ms | 122 ms | 122 ms | 123 ms | 119 ms |
| grammars preloaded | 130 ms | 131 ms | 130 ms | 133 ms | 121 ms |
| file read from disk | 132 ms | 134 ms | 139 ms | 199 ms | 129 ms |
| file decoded | 132 ms | 134 ms | 139 ms | 199 ms | 129 ms |
| document built | 132 ms | 134 ms | 140 ms | 200 ms | 129 ms |
| tokenizer attached to editor | 149 ms | 152 ms | 161 ms | 223 ms | — |
| tabs opened | 136 ms | 139 ms | 147 ms | 209 ms | 143 ms |
| built-in extensions registered | 258 ms | 264 ms | 271 ms | 316 ms | 188 ms |
| frame with file text | 148 ms | 151 ms | 160 ms | 220 ms | 156 ms |
| frame with highlighting | 238 ms | 241 ms | 252 ms | 298 ms | — |
| extension host up | 451 ms | 474 ms | 530 ms | 908 ms | 362 ms |
| startup complete | 251 ms | 255 ms | 263 ms | 308 ms | 180 ms |
| to text (black box) | 149 ms | 153 ms | 160 ms | 221 ms | 156 ms |
| to highlight (black box) | 238 ms | 241 ms | 252 ms | 298 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 1 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 28 ms | 14 ms | 9 ms | 10 ms | — | 5 ms | 3 ms |
| `medium` failed | 27 ms | 18 ms | 12 ms | 10 ms | — | 7 ms | 5 ms |
| `large` failed | 35 ms | 20 ms | 21 ms | 24 ms | — | 15 ms | 15 ms |
| `xlarge` failed | 47 ms | 39 ms | 21 ms | 52 ms | — | 22 ms | 55 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
