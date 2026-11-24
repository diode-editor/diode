# File open benchmark

- Recorded: 2026-11-24T22:25:05.740Z, commit `d846c044ebdb`, diode nightly-d846c04
- Machine: AMD EPYC 9V45 96-Core Processor (4 cores, 16 GB), linux 7.0.0-1020-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 20 ms; binary floor (`diode --version` over PTY, median): 55 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **121 ms** | 87 ms | 142 ms | 213 ms | 13 ms | 297 MB | 11 |
| `medium` | 126.7 KB | 2000 | **123 ms** | 89 ms | 143 ms | 222 ms | 8 ms | 303 MB | 11 |
| `large` | 1.3 MB | 20000 | **143 ms** | 109 ms | 163 ms | 239 ms | 10 ms | 321 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **204 ms** | 169 ms | 224 ms | 290 ms | 13 ms | 373 MB | 5 |
| `log500m` | 497 MB | 5295839 | **129 ms** | 95 ms | 149 ms | — (plaintext) | 3 ms | 351 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 5 ms | 7 ms | 10 ms | 5 ms |
| node ready (bootstrapComplete) | 57 ms | 59 ms | 65 ms | 77 ms | 53 ms |
| bundle executed (main:start) | 58 ms | 59 ms | 65 ms | 77 ms | 53 ms |
| config loaded | 75 ms | 78 ms | 80 ms | 103 ms | 74 ms |
| keybindings loaded | 75 ms | 78 ms | 81 ms | 104 ms | 75 ms |
| session state loaded | 75 ms | 78 ms | 81 ms | 104 ms | 75 ms |
| extensions scanned | 69 ms | 72 ms | 76 ms | 97 ms | 69 ms |
| themes ready | 79 ms | 81 ms | 84 ms | 107 ms | 77 ms |
| DI container created | 81 ms | 84 ms | 87 ms | 109 ms | 80 ms |
| workbench mounted | 112 ms | 115 ms | 119 ms | 139 ms | 109 ms |
| first frame | 112 ms | 115 ms | 119 ms | 139 ms | 109 ms |
| workbench activated | 116 ms | 120 ms | 125 ms | 143 ms | 115 ms |
| grammars preloaded | 121 ms | 124 ms | 134 ms | 148 ms | 117 ms |
| file read from disk | 123 ms | 126 ms | 142 ms | 199 ms | 124 ms |
| file decoded | 123 ms | 126 ms | 142 ms | 199 ms | 124 ms |
| document built | 123 ms | 127 ms | 142 ms | 200 ms | 124 ms |
| tokenizer attached to editor | 139 ms | 143 ms | 162 ms | 224 ms | — |
| tabs opened | 126 ms | 132 ms | 148 ms | 208 ms | 139 ms |
| built-in extensions registered | 239 ms | 246 ms | 263 ms | 313 ms | 185 ms |
| frame with file text | 139 ms | 142 ms | 161 ms | 222 ms | 149 ms |
| frame with highlighting | 213 ms | 222 ms | 239 ms | 289 ms | — |
| extension host up | 404 ms | 448 ms | 513 ms | 854 ms | 328 ms |
| startup complete | 230 ms | 238 ms | 254 ms | 305 ms | 176 ms |
| to text (black box) | 142 ms | 143 ms | 163 ms | 224 ms | 149 ms |
| to highlight (black box) | 213 ms | 222 ms | 239 ms | 290 ms | — |
| gap black − white (text) | 2 ms | 1 ms | 1 ms | 1 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 11 ms | 8 ms | 5 ms | 5 ms | — | 4 ms | 2 ms |
| `medium` failed | 24 ms | 14 ms | 8 ms | 7 ms | — | 6 ms | 4 ms |
| `large` failed | 32 ms | 20 ms | 18 ms | 11 ms | — | 12 ms | 15 ms |
| `xlarge` failed | 26 ms | 26 ms | 16 ms | 16 ms | — | 14 ms | 48 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
