# File open benchmark

- Recorded: 2026-10-27T11:52:26.348Z, commit `26c9918fa2f6`, diode nightly-26c9918
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 26 ms; binary floor (`diode --version` over PTY, median): 65 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **148 ms** | 108 ms | 174 ms | 294 ms | 6 ms | 254 MB | 11 |
| `medium` | 126.7 KB | 2000 | **154 ms** | 115 ms | 180 ms | 305 ms | 4 ms | 278 MB | 11 |
| `large` | 1.3 MB | 20000 | **163 ms** | 124 ms | 189 ms | 331 ms | 12 ms | 296 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **250 ms** | 211 ms | 277 ms | 408 ms | 6 ms | 364 MB | 5 |
| `log500m` | 497 MB | 5295839 | **166 ms** | 127 ms | 192 ms | — (plaintext) | 4 ms | 303 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 8 ms | 8 ms | 6 ms |
| node ready (bootstrapComplete) | 70 ms | 71 ms | 72 ms | 76 ms | 69 ms |
| bundle executed (main:start) | 70 ms | 71 ms | 72 ms | 76 ms | 69 ms |
| config loaded | 91 ms | 90 ms | 93 ms | 94 ms | 91 ms |
| keybindings loaded | 93 ms | 92 ms | 93 ms | 94 ms | 92 ms |
| session state loaded | 93 ms | 92 ms | 93 ms | 95 ms | 92 ms |
| extensions scanned | 86 ms | 87 ms | 87 ms | 90 ms | 86 ms |
| themes ready | 96 ms | 96 ms | 97 ms | 99 ms | 97 ms |
| DI container created | 100 ms | 101 ms | 101 ms | 104 ms | 102 ms |
| workbench mounted | 134 ms | 139 ms | 137 ms | 140 ms | 135 ms |
| first frame | 134 ms | 138 ms | 137 ms | 140 ms | 135 ms |
| workbench activated | 140 ms | 146 ms | 148 ms | 150 ms | 141 ms |
| grammars preloaded | 146 ms | 152 ms | 153 ms | 156 ms | 144 ms |
| file read from disk | 149 ms | 156 ms | 165 ms | 251 ms | 157 ms |
| file decoded | 149 ms | 156 ms | 165 ms | 251 ms | 157 ms |
| document built | 149 ms | 157 ms | 165 ms | 252 ms | 157 ms |
| tokenizer attached to editor | 173 ms | 188 ms | 206 ms | 292 ms | — |
| tabs opened | 154 ms | 162 ms | 176 ms | 262 ms | 176 ms |
| built-in extensions registered | 319 ms | 332 ms | 355 ms | 431 ms | 238 ms |
| frame with file text | 171 ms | 178 ms | 189 ms | 276 ms | 192 ms |
| frame with highlighting | 293 ms | 305 ms | 331 ms | 408 ms | — |
| extension host up | 582 ms | 614 ms | 678 ms | 1112 ms | 435 ms |
| startup complete | 313 ms | 325 ms | 349 ms | 426 ms | 230 ms |
| to text (black box) | 174 ms | 180 ms | 189 ms | 277 ms | 192 ms |
| to highlight (black box) | 294 ms | 305 ms | 331 ms | 408 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 38 ms | 13 ms | 10 ms | 8 ms | 16 ms | 6 ms | 3 ms |
| `medium` | 35 ms | 11 ms | 12 ms | 12 ms | 17 ms | 9 ms | 5 ms |
| `large` | 34 ms | 18 ms | 17 ms | 15 ms | 43 ms | 14 ms | 16 ms |
| `xlarge` | 41 ms | 29 ms | 13 ms | 20 ms | 158 ms | 19 ms | 78 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
