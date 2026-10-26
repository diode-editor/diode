# File open benchmark

- Recorded: 2026-10-26T00:03:47.576Z, commit `6657c7afe950`, diode nightly-6657c7a
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 20 ms; binary floor (`diode --version` over PTY, median): 51 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **105 ms** | 75 ms | 125 ms | 215 ms | 4 ms | 253 MB | 11 |
| `medium` | 126.7 KB | 2000 | **109 ms** | 79 ms | 130 ms | 213 ms | 2 ms | 253 MB | 11 |
| `large` | 1.3 MB | 20000 | **120 ms** | 89 ms | 140 ms | 228 ms | 7 ms | 287 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **191 ms** | 160 ms | 211 ms | 291 ms | 19 ms | 359 MB | 5 |
| `log500m` | 497 MB | 5295839 | **113 ms** | 83 ms | 134 ms | — (plaintext) | 4 ms | 300 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 5 ms | 6 ms | 8 ms | 5 ms |
| node ready (bootstrapComplete) | 55 ms | 56 ms | 58 ms | 71 ms | 52 ms |
| bundle executed (main:start) | 55 ms | 56 ms | 58 ms | 71 ms | 52 ms |
| config loaded | 70 ms | 72 ms | 73 ms | 87 ms | 67 ms |
| keybindings loaded | 70 ms | 73 ms | 74 ms | 87 ms | 67 ms |
| session state loaded | 70 ms | 73 ms | 74 ms | 87 ms | 67 ms |
| extensions scanned | 67 ms | 69 ms | 70 ms | 85 ms | 65 ms |
| themes ready | 73 ms | 75 ms | 76 ms | 91 ms | 70 ms |
| DI container created | 77 ms | 78 ms | 80 ms | 94 ms | 73 ms |
| workbench mounted | 100 ms | 100 ms | 101 ms | 115 ms | 95 ms |
| first frame | 100 ms | 100 ms | 101 ms | 115 ms | 95 ms |
| workbench activated | 103 ms | 103 ms | 105 ms | 118 ms | 98 ms |
| grammars preloaded | 109 ms | 110 ms | 110 ms | 123 ms | 100 ms |
| file read from disk | 111 ms | 113 ms | 121 ms | 195 ms | 110 ms |
| file decoded | 111 ms | 113 ms | 121 ms | 195 ms | 110 ms |
| document built | 111 ms | 113 ms | 121 ms | 195 ms | 110 ms |
| tokenizer attached to editor | 125 ms | 130 ms | 140 ms | 214 ms | — |
| tabs opened | 114 ms | 117 ms | 128 ms | 201 ms | 123 ms |
| built-in extensions registered | 231 ms | 229 ms | 243 ms | 305 ms | 163 ms |
| frame with file text | 124 ms | 128 ms | 138 ms | 211 ms | 133 ms |
| frame with highlighting | 215 ms | 212 ms | 228 ms | 291 ms | — |
| extension host up | 399 ms | 415 ms | 471 ms | 758 ms | 296 ms |
| startup complete | 227 ms | 225 ms | 239 ms | 301 ms | 158 ms |
| to text (black box) | 125 ms | 130 ms | 140 ms | 211 ms | 134 ms |
| to highlight (black box) | 215 ms | 213 ms | 228 ms | 291 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 2 ms | 0 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 25 ms | 9 ms | 7 ms | 8 ms | 12 ms | 5 ms | 3 ms |
| `medium` | 26 ms | 11 ms | 7 ms | 6 ms | 11 ms | 6 ms | 3 ms |
| `large` | 30 ms | 15 ms | 15 ms | 16 ms | 40 ms | 9 ms | 12 ms |
| `xlarge` | 23 ms | 22 ms | 11 ms | 16 ms | 122 ms | 8 ms | 59 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
