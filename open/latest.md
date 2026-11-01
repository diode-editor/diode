# File open benchmark

- Recorded: 2026-11-01T21:36:29.739Z, commit `e4590c71e363`, diode nightly-e4590c7
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 65 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **148 ms** | 108 ms | 173 ms | 289 ms | 11 ms | 255 MB | 11 |
| `medium` | 126.7 KB | 2000 | **152 ms** | 112 ms | 177 ms | 298 ms | 9 ms | 280 MB | 11 |
| `large` | 1.3 MB | 20000 | **167 ms** | 127 ms | 192 ms | 323 ms | 7 ms | 294 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **272 ms** | 232 ms | 297 ms | 424 ms | 9 ms | 370 MB | 5 |
| `log500m` | 497 MB | 5295839 | **163 ms** | 123 ms | 188 ms | — (plaintext) | 4 ms | 272 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 7 ms | 8 ms | 6 ms |
| node ready (bootstrapComplete) | 69 ms | 70 ms | 69 ms | 90 ms | 65 ms |
| bundle executed (main:start) | 69 ms | 70 ms | 69 ms | 90 ms | 65 ms |
| config loaded | 88 ms | 89 ms | 90 ms | 113 ms | 81 ms |
| keybindings loaded | 88 ms | 91 ms | 90 ms | 114 ms | 81 ms |
| session state loaded | 89 ms | 91 ms | 91 ms | 114 ms | 81 ms |
| extensions scanned | 84 ms | 85 ms | 86 ms | 109 ms | 77 ms |
| themes ready | 93 ms | 95 ms | 95 ms | 118 ms | 86 ms |
| DI container created | 97 ms | 99 ms | 99 ms | 122 ms | 91 ms |
| workbench mounted | 133 ms | 133 ms | 137 ms | 153 ms | 129 ms |
| first frame | 133 ms | 133 ms | 137 ms | 153 ms | 129 ms |
| workbench activated | 141 ms | 138 ms | 146 ms | 157 ms | 136 ms |
| grammars preloaded | 146 ms | 145 ms | 150 ms | 163 ms | 139 ms |
| file read from disk | 149 ms | 151 ms | 163 ms | 270 ms | 151 ms |
| file decoded | 149 ms | 151 ms | 163 ms | 270 ms | 151 ms |
| document built | 149 ms | 151 ms | 163 ms | 270 ms | 151 ms |
| tokenizer attached to editor | 174 ms | 182 ms | 207 ms | 311 ms | — |
| tabs opened | 154 ms | 158 ms | 174 ms | 280 ms | 172 ms |
| built-in extensions registered | 314 ms | 324 ms | 348 ms | 447 ms | 228 ms |
| frame with file text | 171 ms | 173 ms | 189 ms | 295 ms | 186 ms |
| frame with highlighting | 288 ms | 297 ms | 322 ms | 424 ms | — |
| extension host up | 559 ms | 616 ms | 670 ms | 1119 ms | 424 ms |
| startup complete | 308 ms | 318 ms | 341 ms | 441 ms | 221 ms |
| to text (black box) | 173 ms | 177 ms | 192 ms | 297 ms | 188 ms |
| to highlight (black box) | 289 ms | 298 ms | 323 ms | 424 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 0 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 34 ms | 14 ms | 10 ms | 10 ms | 23 ms | 7 ms | 4 ms |
| `medium` | 32 ms | 11 ms | 11 ms | 11 ms | 23 ms | 7 ms | 6 ms |
| `large` | 31 ms | 30 ms | 24 ms | 15 ms | 41 ms | 16 ms | 21 ms |
| `xlarge` | 29 ms | 37 ms | 19 ms | 21 ms | 135 ms | 15 ms | 82 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
