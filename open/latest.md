# File open benchmark

- Recorded: 2026-10-21T20:46:42.247Z, commit `30aba4c9250b`, diode nightly-30aba4c
- Machine: Intel(R) Xeon(R) Platinum 8370C CPU @ 2.80GHz (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 23 ms; binary floor (`diode --version` over PTY, median): 56 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **129 ms** | 96 ms | 152 ms | 270 ms | 16 ms | 244 MB | 11 |
| `medium` | 126.7 KB | 2000 | **163 ms** | 130 ms | 186 ms | 307 ms | 15 ms | 248 MB | 11 |
| `large` | 1.3 MB | 20000 | **317 ms** | 284 ms | 340 ms | 446 ms | 12 ms | 301 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **1736 ms** | 1704 ms | 1760 ms | 1915 ms | 44 ms | 498 MB | 5 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` |
| --- | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 5 ms | 6 ms | 8 ms |
| node ready (bootstrapComplete) | 60 ms | 58 ms | 61 ms | 97 ms |
| bundle executed (main:start) | 60 ms | 58 ms | 61 ms | 97 ms |
| config loaded | 77 ms | 72 ms | 76 ms | 123 ms |
| keybindings loaded | 78 ms | 73 ms | 80 ms | 124 ms |
| session state loaded | 78 ms | 73 ms | 80 ms | 124 ms |
| extensions scanned | 75 ms | 69 ms | 74 ms | 120 ms |
| themes ready | 82 ms | 77 ms | 83 ms | 128 ms |
| DI container created | 85 ms | 81 ms | 87 ms | 132 ms |
| workbench mounted | 111 ms | 110 ms | 113 ms | 160 ms |
| first frame | 111 ms | 110 ms | 113 ms | 160 ms |
| workbench activated | 116 ms | 115 ms | 118 ms | 165 ms |
| grammars preloaded | 127 ms | 125 ms | 126 ms | 176 ms |
| file read from disk | 128 ms | 128 ms | 137 ms | 276 ms |
| file decoded | 128 ms | 128 ms | 137 ms | 276 ms |
| document built | 129 ms | 128 ms | 137 ms | 276 ms |
| tokenizer attached to editor | 151 ms | 187 ms | 342 ms | 1761 ms |
| tabs opened | 134 ms | 138 ms | 154 ms | 316 ms |
| built-in extensions registered | 291 ms | 323 ms | 460 ms | 1930 ms |
| frame with file text | 150 ms | 185 ms | 340 ms | 1760 ms |
| frame with highlighting | 269 ms | 306 ms | 446 ms | 1915 ms |
| extension host up | 509 ms | 549 ms | 721 ms | 2452 ms |
| startup complete | 284 ms | 318 ms | 456 ms | 1926 ms |
| to text (black box) | 152 ms | 186 ms | 340 ms | 1760 ms |
| to highlight (black box) | 270 ms | 307 ms | 446 ms | 1915 ms |
| gap black − white (text) | 2 ms | 1 ms | 0 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 38 ms | 12 ms | 12 ms | 10 ms | 15 ms | 9 ms | 5 ms |
| `medium` | 37 ms | 16 ms | 15 ms | 14 ms | 14 ms | 6 ms | 10 ms |
| `large` | 66 ms | 61 ms | 39 ms | 77 ms | 78 ms | 16 ms | 17 ms |
| `xlarge` | 241 ms | 453 ms | 377 ms | 366 ms | 235 ms | 14 ms | 74 ms |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
