# File open benchmark

- Recorded: 2026-11-19T06:15:58.135Z, commit `b92daf1b979b`, diode nightly-b92daf1
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 24 ms; binary floor (`diode --version` over PTY, median): 64 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **144 ms** | 104 ms | 168 ms | 255 ms | 5 ms | 293 MB | 11 |
| `medium` | 126.7 KB | 2000 | **148 ms** | 108 ms | 172 ms | 261 ms | 6 ms | 301 MB | 11 |
| `large` | 1.3 MB | 20000 | **155 ms** | 115 ms | 179 ms | 272 ms | 7 ms | 314 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **226 ms** | 186 ms | 250 ms | 329 ms | 12 ms | 363 MB | 5 |
| `log500m` | 497 MB | 5295839 | **148 ms** | 108 ms | 171 ms | — (plaintext) | 4 ms | 318 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 6 ms | 7 ms | 8 ms | 5 ms |
| node ready (bootstrapComplete) | 68 ms | 71 ms | 71 ms | 86 ms | 63 ms |
| bundle executed (main:start) | 68 ms | 71 ms | 71 ms | 86 ms | 63 ms |
| config loaded | 89 ms | 91 ms | 92 ms | 104 ms | 79 ms |
| keybindings loaded | 89 ms | 91 ms | 94 ms | 107 ms | 80 ms |
| session state loaded | 89 ms | 91 ms | 94 ms | 107 ms | 80 ms |
| extensions scanned | 82 ms | 85 ms | 87 ms | 99 ms | 75 ms |
| themes ready | 93 ms | 95 ms | 97 ms | 111 ms | 87 ms |
| DI container created | 97 ms | 99 ms | 100 ms | 113 ms | 90 ms |
| workbench mounted | 133 ms | 133 ms | 134 ms | 148 ms | 123 ms |
| first frame | 133 ms | 133 ms | 134 ms | 148 ms | 123 ms |
| workbench activated | 142 ms | 144 ms | 140 ms | 154 ms | 134 ms |
| grammars preloaded | 146 ms | 148 ms | 144 ms | 158 ms | 136 ms |
| file read from disk | 148 ms | 151 ms | 154 ms | 228 ms | 145 ms |
| file decoded | 148 ms | 151 ms | 154 ms | 228 ms | 145 ms |
| document built | 148 ms | 151 ms | 154 ms | 228 ms | 145 ms |
| tokenizer attached to editor | 168 ms | 171 ms | 179 ms | 250 ms | — |
| tabs opened | 153 ms | 157 ms | 162 ms | 237 ms | 160 ms |
| built-in extensions registered | 284 ms | 289 ms | 301 ms | 355 ms | 215 ms |
| frame with file text | 166 ms | 169 ms | 178 ms | 248 ms | 171 ms |
| frame with highlighting | 255 ms | 261 ms | 272 ms | 329 ms | — |
| extension host up | 492 ms | 542 ms | 610 ms | 959 ms | 371 ms |
| startup complete | 273 ms | 280 ms | 290 ms | 345 ms | 203 ms |
| to text (black box) | 168 ms | 172 ms | 179 ms | 250 ms | 171 ms |
| to highlight (black box) | 255 ms | 261 ms | 272 ms | 329 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 0 ms | 2 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 30 ms | 14 ms | 12 ms | 8 ms | — | 5 ms | 3 ms |
| `medium` failed | 31 ms | 13 ms | 12 ms | 8 ms | — | 5 ms | 5 ms |
| `large` failed | 27 ms | 19 ms | 18 ms | 18 ms | — | 15 ms | 18 ms |
| `xlarge` failed | 24 ms | 25 ms | 16 ms | 15 ms | — | 11 ms | 67 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
