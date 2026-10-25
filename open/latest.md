# File open benchmark

- Recorded: 2026-10-25T21:20:51.677Z, commit `269b49a819eb`, diode nightly-269b49a
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 20 ms; binary floor (`diode --version` over PTY, median): 51 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **106 ms** | 76 ms | 127 ms | 215 ms | 8 ms | 246 MB | 11 |
| `medium` | 126.7 KB | 2000 | **119 ms** | 89 ms | 139 ms | 227 ms | 5 ms | 248 MB | 11 |
| `large` | 1.3 MB | 20000 | **127 ms** | 97 ms | 148 ms | 239 ms | 8 ms | 288 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **198 ms** | 167 ms | 218 ms | 295 ms | 20 ms | 359 MB | 5 |
| `log500m` | 497 MB | 5295839 | **116 ms** | 85 ms | 136 ms | — (plaintext) | 4 ms | 299 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 5 ms | 7 ms | 10 ms | 5 ms |
| node ready (bootstrapComplete) | 56 ms | 59 ms | 58 ms | 77 ms | 53 ms |
| bundle executed (main:start) | 56 ms | 59 ms | 58 ms | 77 ms | 54 ms |
| config loaded | 71 ms | 73 ms | 73 ms | 95 ms | 68 ms |
| keybindings loaded | 71 ms | 73 ms | 73 ms | 95 ms | 68 ms |
| session state loaded | 72 ms | 73 ms | 73 ms | 95 ms | 69 ms |
| extensions scanned | 69 ms | 71 ms | 70 ms | 91 ms | 66 ms |
| themes ready | 75 ms | 76 ms | 77 ms | 100 ms | 73 ms |
| DI container created | 79 ms | 79 ms | 81 ms | 103 ms | 76 ms |
| workbench mounted | 102 ms | 106 ms | 105 ms | 123 ms | 100 ms |
| first frame | 102 ms | 106 ms | 105 ms | 123 ms | 100 ms |
| workbench activated | 106 ms | 110 ms | 108 ms | 126 ms | 103 ms |
| grammars preloaded | 111 ms | 118 ms | 116 ms | 130 ms | 105 ms |
| file read from disk | 112 ms | 120 ms | 128 ms | 198 ms | 113 ms |
| file decoded | 112 ms | 120 ms | 128 ms | 198 ms | 113 ms |
| document built | 112 ms | 120 ms | 128 ms | 198 ms | 113 ms |
| tokenizer attached to editor | 128 ms | 138 ms | 148 ms | 218 ms | — |
| tabs opened | 115 ms | 125 ms | 136 ms | 205 ms | 127 ms |
| built-in extensions registered | 229 ms | 242 ms | 254 ms | 309 ms | 163 ms |
| frame with file text | 126 ms | 136 ms | 146 ms | 215 ms | 136 ms |
| frame with highlighting | 214 ms | 227 ms | 239 ms | 295 ms | — |
| extension host up | 404 ms | 438 ms | 481 ms | 776 ms | 304 ms |
| startup complete | 225 ms | 239 ms | 250 ms | 305 ms | 160 ms |
| to text (black box) | 127 ms | 139 ms | 148 ms | 218 ms | 136 ms |
| to highlight (black box) | 215 ms | 227 ms | 239 ms | 295 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 26 ms | 9 ms | 6 ms | 8 ms | 12 ms | 5 ms | 3 ms |
| `medium` | 24 ms | 9 ms | 9 ms | 8 ms | 11 ms | 5 ms | 3 ms |
| `large` | 33 ms | 18 ms | 13 ms | 17 ms | 41 ms | 11 ms | 13 ms |
| `xlarge` | 23 ms | 21 ms | 13 ms | 20 ms | 108 ms | 10 ms | 61 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
