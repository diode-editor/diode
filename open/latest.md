# File open benchmark

- Recorded: 2026-11-26T18:43:58.307Z, commit `a61e997189c0`, diode nightly-a61e997
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1020-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 20 ms; binary floor (`diode --version` over PTY, median): 62 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **142 ms** | 100 ms | 162 ms | 254 ms | 9 ms | 299 MB | 11 |
| `medium` | 126.7 KB | 2000 | **143 ms** | 101 ms | 163 ms | 253 ms | 7 ms | 304 MB | 11 |
| `large` | 1.3 MB | 20000 | **154 ms** | 112 ms | 174 ms | 269 ms | 7 ms | 315 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **222 ms** | 180 ms | 242 ms | 316 ms | 13 ms | 368 MB | 5 |
| `log500m` | 497 MB | 5295839 | **150 ms** | 108 ms | 170 ms | — (plaintext) | 7 ms | 348 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 6 ms | 7 ms | 5 ms |
| node ready (bootstrapComplete) | 67 ms | 67 ms | 69 ms | 84 ms | 62 ms |
| bundle executed (main:start) | 67 ms | 67 ms | 69 ms | 84 ms | 62 ms |
| config loaded | 86 ms | 85 ms | 88 ms | 98 ms | 82 ms |
| keybindings loaded | 86 ms | 85 ms | 89 ms | 98 ms | 82 ms |
| session state loaded | 86 ms | 85 ms | 89 ms | 98 ms | 82 ms |
| extensions scanned | 80 ms | 79 ms | 83 ms | 95 ms | 76 ms |
| themes ready | 90 ms | 91 ms | 93 ms | 103 ms | 87 ms |
| DI container created | 93 ms | 94 ms | 97 ms | 107 ms | 90 ms |
| workbench mounted | 129 ms | 127 ms | 130 ms | 145 ms | 124 ms |
| first frame | 129 ms | 127 ms | 130 ms | 145 ms | 124 ms |
| workbench activated | 134 ms | 136 ms | 135 ms | 151 ms | 129 ms |
| grammars preloaded | 139 ms | 141 ms | 140 ms | 155 ms | 131 ms |
| file read from disk | 141 ms | 144 ms | 151 ms | 223 ms | 139 ms |
| file decoded | 141 ms | 144 ms | 151 ms | 223 ms | 139 ms |
| document built | 141 ms | 144 ms | 151 ms | 223 ms | 139 ms |
| tokenizer attached to editor | 161 ms | 163 ms | 172 ms | 243 ms | — |
| tabs opened | 145 ms | 149 ms | 157 ms | 230 ms | 156 ms |
| built-in extensions registered | 279 ms | 280 ms | 295 ms | 343 ms | 213 ms |
| frame with file text | 161 ms | 161 ms | 170 ms | 242 ms | 169 ms |
| frame with highlighting | 253 ms | 253 ms | 269 ms | 316 ms | — |
| extension host up | 478 ms | 526 ms | 582 ms | 946 ms | 361 ms |
| startup complete | 270 ms | 270 ms | 285 ms | 332 ms | 201 ms |
| to text (black box) | 162 ms | 163 ms | 174 ms | 242 ms | 170 ms |
| to highlight (black box) | 254 ms | 253 ms | 269 ms | 316 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 32 ms | 15 ms | 10 ms | 8 ms | — | 6 ms | 3 ms |
| `medium` failed | 26 ms | 14 ms | 9 ms | 10 ms | — | 5 ms | 5 ms |
| `large` failed | 31 ms | 21 ms | 21 ms | 22 ms | — | 11 ms | 17 ms |
| `xlarge` failed | 28 ms | 28 ms | 13 ms | 18 ms | — | 16 ms | 63 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
