# File open benchmark

- Recorded: 2026-10-21T20:39:25.989Z, commit `3924b704ea25`, diode nightly-3924b70
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 21 ms; binary floor (`diode --version` over PTY, median): 48 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **105 ms** | 78 ms | 126 ms | 215 ms | 6 ms | 244 MB | 11 |
| `medium` | 126.7 KB | 2000 | **130 ms** | 103 ms | 152 ms | 240 ms | 4 ms | 249 MB | 11 |
| `large` | 1.3 MB | 20000 | **258 ms** | 231 ms | 279 ms | 365 ms | 12 ms | 305 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **1236 ms** | 1209 ms | 1257 ms | 1386 ms | 56 ms | 500 MB | 5 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` |
| --- | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 7 ms | 11 ms |
| node ready (bootstrapComplete) | 54 ms | 56 ms | 58 ms | 80 ms |
| bundle executed (main:start) | 54 ms | 56 ms | 58 ms | 80 ms |
| config loaded | 69 ms | 71 ms | 71 ms | 108 ms |
| keybindings loaded | 69 ms | 71 ms | 71 ms | 108 ms |
| session state loaded | 70 ms | 71 ms | 71 ms | 109 ms |
| extensions scanned | 66 ms | 68 ms | 69 ms | 103 ms |
| themes ready | 72 ms | 74 ms | 74 ms | 112 ms |
| DI container created | 75 ms | 77 ms | 78 ms | 117 ms |
| workbench mounted | 96 ms | 99 ms | 100 ms | 144 ms |
| first frame | 96 ms | 99 ms | 100 ms | 144 ms |
| workbench activated | 100 ms | 102 ms | 104 ms | 149 ms |
| grammars preloaded | 107 ms | 110 ms | 112 ms | 154 ms |
| file read from disk | 108 ms | 111 ms | 124 ms | 219 ms |
| file decoded | 108 ms | 111 ms | 124 ms | 219 ms |
| document built | 108 ms | 112 ms | 124 ms | 219 ms |
| tokenizer attached to editor | 125 ms | 151 ms | 281 ms | 1258 ms |
| tabs opened | 112 ms | 118 ms | 139 ms | 250 ms |
| built-in extensions registered | 231 ms | 255 ms | 381 ms | 1401 ms |
| frame with file text | 125 ms | 150 ms | 279 ms | 1256 ms |
| frame with highlighting | 215 ms | 239 ms | 365 ms | 1386 ms |
| extension host up | 408 ms | 452 ms | 596 ms | 1889 ms |
| startup complete | 227 ms | 251 ms | 377 ms | 1398 ms |
| to text (black box) | 126 ms | 152 ms | 279 ms | 1257 ms |
| to highlight (black box) | 215 ms | 240 ms | 365 ms | 1386 ms |
| gap black − white (text) | 1 ms | 2 ms | 0 ms | 2 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 31 ms | 11 ms | 12 ms | 10 ms | 12 ms | 7 ms | 2 ms |
| `medium` | 33 ms | 13 ms | 15 ms | 11 ms | 14 ms | 6 ms | 3 ms |
| `large` | 56 ms | 50 ms | 35 ms | 50 ms | 65 ms | 12 ms | 13 ms |
| `xlarge` | 200 ms | 310 ms | 258 ms | 254 ms | 248 ms | 8 ms | 51 ms |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
