# File open benchmark

- Recorded: 2026-11-05T23:36:50.363Z, commit `abdedbc72e33`, diode nightly-abdedbc
- Machine: INTEL(R) XEON(R) PLATINUM 8573C (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 21 ms; binary floor (`diode --version` over PTY, median): 53 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **118 ms** | 86 ms | 139 ms | 243 ms | 8 ms | 258 MB | 11 |
| `medium` | 126.7 KB | 2000 | **121 ms** | 89 ms | 142 ms | 237 ms | 4 ms | 282 MB | 11 |
| `large` | 1.3 MB | 20000 | **133 ms** | 101 ms | 154 ms | 253 ms | 5 ms | 293 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **205 ms** | 173 ms | 226 ms | 307 ms | 9 ms | 347 MB | 5 |
| `log500m` | 497 MB | 5295839 | **127 ms** | 95 ms | 148 ms | — (plaintext) | 1 ms | 273 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 5 ms | 7 ms | 6 ms | 4 ms |
| node ready (bootstrapComplete) | 57 ms | 58 ms | 58 ms | 66 ms | 54 ms |
| bundle executed (main:start) | 57 ms | 58 ms | 58 ms | 66 ms | 54 ms |
| config loaded | 73 ms | 72 ms | 72 ms | 79 ms | 69 ms |
| keybindings loaded | 73 ms | 72 ms | 75 ms | 79 ms | 69 ms |
| session state loaded | 74 ms | 72 ms | 75 ms | 79 ms | 69 ms |
| extensions scanned | 71 ms | 69 ms | 69 ms | 77 ms | 66 ms |
| themes ready | 78 ms | 76 ms | 77 ms | 83 ms | 73 ms |
| DI container created | 82 ms | 79 ms | 80 ms | 86 ms | 77 ms |
| workbench mounted | 109 ms | 107 ms | 107 ms | 114 ms | 104 ms |
| first frame | 109 ms | 107 ms | 107 ms | 114 ms | 104 ms |
| workbench activated | 113 ms | 111 ms | 112 ms | 118 ms | 108 ms |
| grammars preloaded | 119 ms | 119 ms | 121 ms | 128 ms | 114 ms |
| file read from disk | 120 ms | 123 ms | 132 ms | 207 ms | 123 ms |
| file decoded | 120 ms | 123 ms | 132 ms | 207 ms | 123 ms |
| document built | 121 ms | 123 ms | 132 ms | 207 ms | 123 ms |
| tokenizer attached to editor | 136 ms | 141 ms | 155 ms | 227 ms | — |
| tabs opened | 124 ms | 128 ms | 139 ms | 214 ms | 137 ms |
| built-in extensions registered | 260 ms | 257 ms | 271 ms | 324 ms | 182 ms |
| frame with file text | 135 ms | 139 ms | 153 ms | 225 ms | 148 ms |
| frame with highlighting | 243 ms | 237 ms | 253 ms | 307 ms | — |
| extension host up | 451 ms | 467 ms | 523 ms | 944 ms | 344 ms |
| startup complete | 253 ms | 248 ms | 264 ms | 317 ms | 172 ms |
| to text (black box) | 139 ms | 142 ms | 154 ms | 226 ms | 148 ms |
| to highlight (black box) | 243 ms | 237 ms | 253 ms | 307 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 1 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 29 ms | 10 ms | 7 ms | 7 ms | — | 4 ms | 3 ms |
| `medium` failed | 27 ms | 11 ms | 8 ms | 7 ms | — | 5 ms | 4 ms |
| `large` failed | 35 ms | 22 ms | 19 ms | 24 ms | — | 12 ms | 17 ms |
| `xlarge` failed | 27 ms | 34 ms | 20 ms | 43 ms | — | 18 ms | 60 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
