# File open benchmark

- Recorded: 2026-10-25T11:07:51.847Z, commit `3803bf28e004`, diode nightly-3803bf2
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 60 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **133 ms** | 98 ms | 158 ms | 280 ms | 15 ms | 249 MB | 11 |
| `medium` | 126.7 KB | 2000 | **148 ms** | 113 ms | 173 ms | 289 ms | 14 ms | 263 MB | 11 |
| `large` | 1.3 MB | 20000 | **155 ms** | 120 ms | 180 ms | 295 ms | 5 ms | 282 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **239 ms** | 204 ms | 264 ms | 365 ms | 3 ms | 351 MB | 5 |
| `log500m` | 497 MB | 5295839 | **158 ms** | 123 ms | 183 ms | — (plaintext) | 4 ms | 262 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 7 ms | 8 ms | 6 ms |
| node ready (bootstrapComplete) | 65 ms | 69 ms | 69 ms | 80 ms | 62 ms |
| bundle executed (main:start) | 65 ms | 69 ms | 70 ms | 80 ms | 62 ms |
| config loaded | 85 ms | 89 ms | 88 ms | 96 ms | 80 ms |
| keybindings loaded | 86 ms | 89 ms | 89 ms | 96 ms | 81 ms |
| session state loaded | 86 ms | 89 ms | 89 ms | 96 ms | 81 ms |
| extensions scanned | 79 ms | 84 ms | 85 ms | 92 ms | 76 ms |
| themes ready | 90 ms | 92 ms | 94 ms | 101 ms | 86 ms |
| DI container created | 95 ms | 97 ms | 98 ms | 106 ms | 90 ms |
| workbench mounted | 126 ms | 132 ms | 129 ms | 137 ms | 121 ms |
| first frame | 126 ms | 132 ms | 129 ms | 137 ms | 121 ms |
| workbench activated | 131 ms | 137 ms | 135 ms | 142 ms | 127 ms |
| grammars preloaded | 137 ms | 147 ms | 144 ms | 149 ms | 133 ms |
| file read from disk | 139 ms | 151 ms | 156 ms | 241 ms | 149 ms |
| file decoded | 139 ms | 151 ms | 156 ms | 241 ms | 149 ms |
| document built | 139 ms | 151 ms | 157 ms | 242 ms | 149 ms |
| tokenizer attached to editor | 160 ms | 175 ms | 182 ms | 266 ms | — |
| tabs opened | 143 ms | 158 ms | 166 ms | 251 ms | 169 ms |
| built-in extensions registered | 300 ms | 312 ms | 314 ms | 385 ms | 221 ms |
| frame with file text | 159 ms | 173 ms | 180 ms | 264 ms | 183 ms |
| frame with highlighting | 280 ms | 289 ms | 294 ms | 365 ms | — |
| extension host up | 526 ms | 565 ms | 615 ms | 935 ms | 401 ms |
| startup complete | 295 ms | 307 ms | 309 ms | 380 ms | 216 ms |
| to text (black box) | 158 ms | 173 ms | 180 ms | 264 ms | 183 ms |
| to highlight (black box) | 280 ms | 289 ms | 295 ms | 365 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 33 ms | 13 ms | 10 ms | 12 ms | 15 ms | 7 ms | 4 ms |
| `medium` | 33 ms | 14 ms | 12 ms | 10 ms | 14 ms | 8 ms | 7 ms |
| `large` | 37 ms | 26 ms | 16 ms | 16 ms | 39 ms | 15 ms | 18 ms |
| `xlarge` | 29 ms | 15 ms | 10 ms | 10 ms | 97 ms | 9 ms | 74 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
