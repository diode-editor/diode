# File open benchmark

- Recorded: 2026-10-24T12:30:05.833Z, commit `8794f6fcd82d`, diode nightly-8794f6f
- Machine: INTEL(R) XEON(R) PLATINUM 8573C (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 23 ms; binary floor (`diode --version` over PTY, median): 56 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **125 ms** | 92 ms | 148 ms | 269 ms | 11 ms | 242 MB | 11 |
| `medium` | 126.7 KB | 2000 | **128 ms** | 95 ms | 152 ms | 265 ms | 3 ms | 245 MB | 11 |
| `large` | 1.3 MB | 20000 | **140 ms** | 108 ms | 164 ms | 272 ms | 9 ms | 287 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **225 ms** | 192 ms | 248 ms | 347 ms | 22 ms | 349 MB | 5 |
| `log500m` | 497 MB | 5295839 | **136 ms** | 103 ms | 159 ms | — (plaintext) | 7 ms | 260 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 7 ms | 9 ms | 5 ms |
| node ready (bootstrapComplete) | 60 ms | 59 ms | 61 ms | 72 ms | 58 ms |
| bundle executed (main:start) | 60 ms | 59 ms | 61 ms | 72 ms | 58 ms |
| config loaded | 76 ms | 76 ms | 78 ms | 85 ms | 76 ms |
| keybindings loaded | 78 ms | 77 ms | 80 ms | 85 ms | 77 ms |
| session state loaded | 78 ms | 77 ms | 80 ms | 86 ms | 77 ms |
| extensions scanned | 74 ms | 72 ms | 76 ms | 82 ms | 72 ms |
| themes ready | 82 ms | 80 ms | 83 ms | 90 ms | 80 ms |
| DI container created | 86 ms | 83 ms | 87 ms | 94 ms | 84 ms |
| workbench mounted | 114 ms | 112 ms | 113 ms | 122 ms | 109 ms |
| first frame | 114 ms | 112 ms | 113 ms | 122 ms | 109 ms |
| workbench activated | 119 ms | 117 ms | 118 ms | 127 ms | 114 ms |
| grammars preloaded | 127 ms | 127 ms | 128 ms | 138 ms | 122 ms |
| file read from disk | 129 ms | 131 ms | 143 ms | 227 ms | 132 ms |
| file decoded | 129 ms | 131 ms | 143 ms | 227 ms | 132 ms |
| document built | 129 ms | 131 ms | 143 ms | 227 ms | 132 ms |
| tokenizer attached to editor | 148 ms | 151 ms | 165 ms | 249 ms | — |
| tabs opened | 133 ms | 137 ms | 151 ms | 236 ms | 147 ms |
| built-in extensions registered | 283 ms | 282 ms | 288 ms | 362 ms | 189 ms |
| frame with file text | 147 ms | 149 ms | 162 ms | 247 ms | 159 ms |
| frame with highlighting | 267 ms | 265 ms | 272 ms | 346 ms | — |
| extension host up | 481 ms | 504 ms | 555 ms | 867 ms | 357 ms |
| startup complete | 279 ms | 278 ms | 283 ms | 357 ms | 183 ms |
| to text (black box) | 148 ms | 152 ms | 164 ms | 248 ms | 159 ms |
| to highlight (black box) | 269 ms | 265 ms | 272 ms | 347 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 2 ms | 0 ms | 2 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 38 ms | 13 ms | 9 ms | 9 ms | 15 ms | 7 ms | 3 ms |
| `medium` | 29 ms | 12 ms | 10 ms | 7 ms | 13 ms | 6 ms | 5 ms |
| `large` | 32 ms | 17 ms | 17 ms | 18 ms | 50 ms | 13 ms | 16 ms |
| `xlarge` | 29 ms | 24 ms | 15 ms | 17 ms | 118 ms | 12 ms | 65 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
