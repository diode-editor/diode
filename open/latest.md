# File open benchmark

- Recorded: 2026-10-24T20:46:36.865Z, commit `89043fe658fc`, diode nightly-89043fe
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 24 ms; binary floor (`diode --version` over PTY, median): 60 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **140 ms** | 104 ms | 164 ms | 276 ms | 5 ms | 244 MB | 11 |
| `medium` | 126.7 KB | 2000 | **144 ms** | 108 ms | 168 ms | 284 ms | 7 ms | 255 MB | 11 |
| `large` | 1.3 MB | 20000 | **161 ms** | 125 ms | 185 ms | 299 ms | 8 ms | 285 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **251 ms** | 215 ms | 275 ms | 377 ms | 5 ms | 346 MB | 5 |
| `log500m` | 497 MB | 5295839 | **145 ms** | 109 ms | 168 ms | — (plaintext) | 4 ms | 293 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 7 ms | 8 ms | 6 ms |
| node ready (bootstrapComplete) | 66 ms | 66 ms | 68 ms | 76 ms | 60 ms |
| bundle executed (main:start) | 66 ms | 66 ms | 68 ms | 76 ms | 60 ms |
| config loaded | 84 ms | 85 ms | 88 ms | 95 ms | 79 ms |
| keybindings loaded | 86 ms | 86 ms | 89 ms | 95 ms | 79 ms |
| session state loaded | 86 ms | 86 ms | 89 ms | 95 ms | 80 ms |
| extensions scanned | 81 ms | 81 ms | 85 ms | 88 ms | 77 ms |
| themes ready | 90 ms | 90 ms | 93 ms | 99 ms | 84 ms |
| DI container created | 95 ms | 95 ms | 98 ms | 104 ms | 89 ms |
| workbench mounted | 125 ms | 126 ms | 131 ms | 137 ms | 117 ms |
| first frame | 125 ms | 126 ms | 131 ms | 137 ms | 117 ms |
| workbench activated | 130 ms | 132 ms | 138 ms | 142 ms | 122 ms |
| grammars preloaded | 140 ms | 141 ms | 147 ms | 153 ms | 124 ms |
| file read from disk | 143 ms | 144 ms | 160 ms | 251 ms | 138 ms |
| file decoded | 143 ms | 144 ms | 160 ms | 251 ms | 138 ms |
| document built | 143 ms | 145 ms | 160 ms | 251 ms | 138 ms |
| tokenizer attached to editor | 163 ms | 167 ms | 185 ms | 274 ms | — |
| tabs opened | 147 ms | 151 ms | 168 ms | 260 ms | 157 ms |
| built-in extensions registered | 298 ms | 304 ms | 318 ms | 397 ms | 206 ms |
| frame with file text | 161 ms | 165 ms | 183 ms | 273 ms | 168 ms |
| frame with highlighting | 276 ms | 284 ms | 299 ms | 377 ms | — |
| extension host up | 528 ms | 552 ms | 615 ms | 951 ms | 384 ms |
| startup complete | 293 ms | 300 ms | 313 ms | 391 ms | 200 ms |
| to text (black box) | 164 ms | 168 ms | 185 ms | 275 ms | 168 ms |
| to highlight (black box) | 276 ms | 284 ms | 299 ms | 377 ms | — |
| gap black − white (text) | 2 ms | 1 ms | 2 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 35 ms | 11 ms | 8 ms | 10 ms | 15 ms | 9 ms | 3 ms |
| `medium` | 38 ms | 14 ms | 11 ms | 10 ms | 14 ms | 7 ms | 6 ms |
| `large` | 39 ms | 25 ms | 18 ms | 15 ms | 40 ms | 19 ms | 16 ms |
| `xlarge` | 30 ms | 19 ms | 10 ms | 10 ms | 97 ms | 11 ms | 76 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
