# File open benchmark

- Recorded: 2026-10-27T01:58:03.505Z, commit `2fa06ba1ab5c`, diode nightly-2fa06ba
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 61 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **142 ms** | 105 ms | 166 ms | 275 ms | 10 ms | 255 MB | 11 |
| `medium` | 126.7 KB | 2000 | **138 ms** | 101 ms | 162 ms | 277 ms | 5 ms | 276 MB | 11 |
| `large` | 1.3 MB | 20000 | **158 ms** | 122 ms | 183 ms | 298 ms | 13 ms | 294 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **239 ms** | 202 ms | 263 ms | 366 ms | 6 ms | 368 MB | 5 |
| `log500m` | 497 MB | 5295839 | **151 ms** | 114 ms | 175 ms | — (plaintext) | 3 ms | 297 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 8 ms | 9 ms | 6 ms |
| node ready (bootstrapComplete) | 67 ms | 66 ms | 70 ms | 78 ms | 63 ms |
| bundle executed (main:start) | 67 ms | 66 ms | 70 ms | 78 ms | 63 ms |
| config loaded | 89 ms | 86 ms | 89 ms | 99 ms | 83 ms |
| keybindings loaded | 89 ms | 88 ms | 89 ms | 99 ms | 84 ms |
| session state loaded | 89 ms | 88 ms | 89 ms | 99 ms | 84 ms |
| extensions scanned | 84 ms | 83 ms | 86 ms | 95 ms | 78 ms |
| themes ready | 92 ms | 91 ms | 92 ms | 102 ms | 87 ms |
| DI container created | 96 ms | 95 ms | 96 ms | 106 ms | 91 ms |
| workbench mounted | 127 ms | 125 ms | 133 ms | 136 ms | 123 ms |
| first frame | 127 ms | 125 ms | 133 ms | 136 ms | 123 ms |
| workbench activated | 134 ms | 129 ms | 138 ms | 141 ms | 127 ms |
| grammars preloaded | 143 ms | 135 ms | 148 ms | 148 ms | 129 ms |
| file read from disk | 145 ms | 140 ms | 159 ms | 241 ms | 141 ms |
| file decoded | 145 ms | 140 ms | 159 ms | 241 ms | 141 ms |
| document built | 145 ms | 140 ms | 159 ms | 241 ms | 141 ms |
| tokenizer attached to editor | 164 ms | 163 ms | 184 ms | 265 ms | — |
| tabs opened | 149 ms | 146 ms | 167 ms | 250 ms | 161 ms |
| built-in extensions registered | 296 ms | 298 ms | 318 ms | 386 ms | 215 ms |
| frame with file text | 163 ms | 162 ms | 182 ms | 263 ms | 175 ms |
| frame with highlighting | 275 ms | 277 ms | 297 ms | 366 ms | — |
| extension host up | 552 ms | 574 ms | 631 ms | 962 ms | 396 ms |
| startup complete | 290 ms | 291 ms | 312 ms | 380 ms | 208 ms |
| to text (black box) | 166 ms | 162 ms | 183 ms | 263 ms | 175 ms |
| to highlight (black box) | 275 ms | 277 ms | 298 ms | 366 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 2 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 34 ms | 11 ms | 10 ms | 8 ms | 17 ms | 7 ms | 4 ms |
| `medium` | 34 ms | 10 ms | 11 ms | 8 ms | 13 ms | 6 ms | 4 ms |
| `large` | 43 ms | 19 ms | 15 ms | 13 ms | 38 ms | 13 ms | 14 ms |
| `xlarge` | 35 ms | 17 ms | 8 ms | 11 ms | 94 ms | 7 ms | 73 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
