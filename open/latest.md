# File open benchmark

- Recorded: 2026-10-21T21:06:17.096Z, commit `1316f33ed1a0`, diode nightly-1316f33
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 21 ms; binary floor (`diode --version` over PTY, median): 50 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **111 ms** | 83 ms | 133 ms | 226 ms | 4 ms | 244 MB | 11 |
| `medium` | 126.7 KB | 2000 | **140 ms** | 111 ms | 161 ms | 255 ms | 9 ms | 248 MB | 11 |
| `large` | 1.3 MB | 20000 | **269 ms** | 240 ms | 290 ms | 378 ms | 25 ms | 300 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **1214 ms** | 1185 ms | 1235 ms | 1366 ms | 2 ms | 500 MB | 5 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` |
| --- | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 8 ms | 7 ms |
| node ready (bootstrapComplete) | 56 ms | 56 ms | 61 ms | 69 ms |
| bundle executed (main:start) | 56 ms | 56 ms | 61 ms | 69 ms |
| config loaded | 70 ms | 71 ms | 78 ms | 91 ms |
| keybindings loaded | 71 ms | 71 ms | 78 ms | 91 ms |
| session state loaded | 71 ms | 71 ms | 78 ms | 92 ms |
| extensions scanned | 68 ms | 68 ms | 73 ms | 87 ms |
| themes ready | 74 ms | 74 ms | 81 ms | 95 ms |
| DI container created | 77 ms | 77 ms | 84 ms | 99 ms |
| workbench mounted | 101 ms | 100 ms | 107 ms | 122 ms |
| first frame | 101 ms | 100 ms | 107 ms | 122 ms |
| workbench activated | 105 ms | 103 ms | 111 ms | 126 ms |
| grammars preloaded | 112 ms | 111 ms | 119 ms | 131 ms |
| file read from disk | 113 ms | 113 ms | 130 ms | 193 ms |
| file decoded | 113 ms | 113 ms | 130 ms | 193 ms |
| document built | 113 ms | 113 ms | 130 ms | 193 ms |
| tokenizer attached to editor | 131 ms | 159 ms | 291 ms | 1238 ms |
| tabs opened | 117 ms | 120 ms | 147 ms | 231 ms |
| built-in extensions registered | 241 ms | 270 ms | 394 ms | 1380 ms |
| frame with file text | 130 ms | 157 ms | 290 ms | 1235 ms |
| frame with highlighting | 225 ms | 255 ms | 378 ms | 1366 ms |
| extension host up | 435 ms | 463 ms | 625 ms | 1859 ms |
| startup complete | 237 ms | 266 ms | 390 ms | 1377 ms |
| to text (black box) | 133 ms | 161 ms | 290 ms | 1235 ms |
| to highlight (black box) | 226 ms | 255 ms | 378 ms | 1366 ms |
| gap black − white (text) | 1 ms | 2 ms | 0 ms | 2 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 34 ms | 13 ms | 12 ms | 8 ms | 13 ms | 9 ms | 2 ms |
| `medium` | 34 ms | 16 ms | 17 ms | 14 ms | 13 ms | 6 ms | 3 ms |
| `large` | 52 ms | 41 ms | 35 ms | 37 ms | 64 ms | 10 ms | 15 ms |
| `xlarge` | 193 ms | 344 ms | 285 ms | 215 ms | 279 ms | 9 ms | 49 ms |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
