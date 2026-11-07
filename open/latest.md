# File open benchmark

- Recorded: 2026-11-07T22:52:16.851Z, commit `3815c62f1ba9`, diode nightly-3815c62
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 20 ms; binary floor (`diode --version` over PTY, median): 55 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **121 ms** | 85 ms | 141 ms | 231 ms | 11 ms | 280 MB | 11 |
| `medium` | 126.7 KB | 2000 | **126 ms** | 90 ms | 146 ms | 233 ms | 14 ms | 287 MB | 11 |
| `large` | 1.3 MB | 20000 | **139 ms** | 103 ms | 159 ms | 245 ms | 4 ms | 298 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **215 ms** | 180 ms | 235 ms | 307 ms | 9 ms | 356 MB | 5 |
| `log500m` | 497 MB | 5295839 | **130 ms** | 94 ms | 150 ms | — (plaintext) | 6 ms | 313 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 5 ms | 7 ms | 10 ms | 5 ms |
| node ready (bootstrapComplete) | 59 ms | 60 ms | 63 ms | 82 ms | 56 ms |
| bundle executed (main:start) | 59 ms | 60 ms | 63 ms | 82 ms | 56 ms |
| config loaded | 75 ms | 78 ms | 82 ms | 100 ms | 70 ms |
| keybindings loaded | 76 ms | 79 ms | 82 ms | 100 ms | 72 ms |
| session state loaded | 76 ms | 79 ms | 82 ms | 100 ms | 72 ms |
| extensions scanned | 72 ms | 74 ms | 80 ms | 97 ms | 66 ms |
| themes ready | 80 ms | 83 ms | 85 ms | 105 ms | 75 ms |
| DI container created | 83 ms | 86 ms | 87 ms | 108 ms | 78 ms |
| workbench mounted | 111 ms | 112 ms | 115 ms | 138 ms | 107 ms |
| first frame | 111 ms | 112 ms | 115 ms | 138 ms | 107 ms |
| workbench activated | 116 ms | 119 ms | 122 ms | 145 ms | 114 ms |
| grammars preloaded | 121 ms | 122 ms | 128 ms | 152 ms | 116 ms |
| file read from disk | 123 ms | 125 ms | 136 ms | 214 ms | 125 ms |
| file decoded | 123 ms | 125 ms | 136 ms | 214 ms | 125 ms |
| document built | 123 ms | 125 ms | 137 ms | 214 ms | 125 ms |
| tokenizer attached to editor | 141 ms | 146 ms | 158 ms | 237 ms | — |
| tabs opened | 126 ms | 131 ms | 143 ms | 222 ms | 140 ms |
| built-in extensions registered | 255 ms | 255 ms | 268 ms | 328 ms | 188 ms |
| frame with file text | 140 ms | 144 ms | 156 ms | 235 ms | 150 ms |
| frame with highlighting | 230 ms | 233 ms | 245 ms | 307 ms | — |
| extension host up | 453 ms | 494 ms | 542 ms | 923 ms | 342 ms |
| startup complete | 248 ms | 247 ms | 261 ms | 321 ms | 180 ms |
| to text (black box) | 141 ms | 146 ms | 159 ms | 235 ms | 150 ms |
| to highlight (black box) | 231 ms | 233 ms | 245 ms | 307 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 1 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 25 ms | 10 ms | 9 ms | 8 ms | — | 5 ms | 3 ms |
| `medium` failed | 23 ms | 11 ms | 7 ms | 9 ms | — | 5 ms | 4 ms |
| `large` failed | 37 ms | 17 ms | 18 ms | 15 ms | — | 15 ms | 15 ms |
| `xlarge` failed | 28 ms | 26 ms | 14 ms | 22 ms | — | 23 ms | 63 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
