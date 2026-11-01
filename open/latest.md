# File open benchmark

- Recorded: 2026-11-01T00:02:17.429Z, commit `b7cfb1e3493d`, diode nightly-b7cfb1e
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 23 ms; binary floor (`diode --version` over PTY, median): 62 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **137 ms** | 98 ms | 160 ms | 278 ms | 17 ms | 266 MB | 11 |
| `medium` | 126.7 KB | 2000 | **146 ms** | 106 ms | 168 ms | 290 ms | 2 ms | 281 MB | 11 |
| `large` | 1.3 MB | 20000 | **161 ms** | 121 ms | 184 ms | 308 ms | 7 ms | 298 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **237 ms** | 197 ms | 259 ms | 385 ms | 1 ms | 370 MB | 5 |
| `log500m` | 497 MB | 5295839 | **165 ms** | 125 ms | 188 ms | — (plaintext) | 10 ms | 305 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 7 ms | 7 ms | 6 ms |
| node ready (bootstrapComplete) | 67 ms | 66 ms | 69 ms | 72 ms | 64 ms |
| bundle executed (main:start) | 67 ms | 66 ms | 69 ms | 72 ms | 64 ms |
| config loaded | 85 ms | 83 ms | 84 ms | 89 ms | 82 ms |
| keybindings loaded | 86 ms | 86 ms | 84 ms | 89 ms | 82 ms |
| session state loaded | 86 ms | 86 ms | 84 ms | 89 ms | 83 ms |
| extensions scanned | 81 ms | 80 ms | 81 ms | 85 ms | 79 ms |
| themes ready | 92 ms | 90 ms | 91 ms | 94 ms | 88 ms |
| DI container created | 95 ms | 94 ms | 94 ms | 98 ms | 92 ms |
| workbench mounted | 125 ms | 126 ms | 128 ms | 131 ms | 126 ms |
| first frame | 125 ms | 126 ms | 128 ms | 131 ms | 126 ms |
| workbench activated | 130 ms | 135 ms | 137 ms | 141 ms | 131 ms |
| grammars preloaded | 136 ms | 142 ms | 143 ms | 146 ms | 138 ms |
| file read from disk | 139 ms | 146 ms | 157 ms | 232 ms | 153 ms |
| file decoded | 139 ms | 146 ms | 157 ms | 232 ms | 153 ms |
| document built | 140 ms | 146 ms | 157 ms | 232 ms | 153 ms |
| tokenizer attached to editor | 162 ms | 175 ms | 197 ms | 275 ms | — |
| tabs opened | 144 ms | 153 ms | 166 ms | 243 ms | 173 ms |
| built-in extensions registered | 304 ms | 315 ms | 330 ms | 409 ms | 233 ms |
| frame with file text | 159 ms | 167 ms | 181 ms | 259 ms | 188 ms |
| frame with highlighting | 277 ms | 290 ms | 307 ms | 385 ms | — |
| extension host up | 544 ms | 576 ms | 652 ms | 1078 ms | 409 ms |
| startup complete | 297 ms | 309 ms | 325 ms | 403 ms | 225 ms |
| to text (black box) | 160 ms | 168 ms | 184 ms | 259 ms | 188 ms |
| to highlight (black box) | 278 ms | 290 ms | 308 ms | 385 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 3 ms | 1 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 37 ms | 12 ms | 11 ms | 9 ms | 17 ms | 9 ms | 4 ms |
| `medium` | 29 ms | 11 ms | 11 ms | 11 ms | 18 ms | 6 ms | 5 ms |
| `large` | 33 ms | 21 ms | 20 ms | 16 ms | 45 ms | 14 ms | 15 ms |
| `xlarge` | 29 ms | 18 ms | 11 ms | 12 ms | 97 ms | 8 ms | 79 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
