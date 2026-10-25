# File open benchmark

- Recorded: 2026-10-25T15:21:44.194Z, commit `3dcece405ead`, diode nightly-3dcece4
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 27 ms; binary floor (`diode --version` over PTY, median): 60 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **138 ms** | 104 ms | 165 ms | 284 ms | 9 ms | 248 MB | 11 |
| `medium` | 126.7 KB | 2000 | **137 ms** | 104 ms | 164 ms | 280 ms | 2 ms | 263 MB | 11 |
| `large` | 1.3 MB | 20000 | **149 ms** | 116 ms | 176 ms | 294 ms | 4 ms | 284 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **237 ms** | 204 ms | 264 ms | 363 ms | 13 ms | 354 MB | 5 |
| `log500m` | 497 MB | 5295839 | **144 ms** | 111 ms | 171 ms | — (plaintext) | 2 ms | 291 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 7 ms | 8 ms | 6 ms |
| node ready (bootstrapComplete) | 65 ms | 66 ms | 69 ms | 80 ms | 62 ms |
| bundle executed (main:start) | 65 ms | 66 ms | 69 ms | 80 ms | 62 ms |
| config loaded | 86 ms | 87 ms | 84 ms | 104 ms | 82 ms |
| keybindings loaded | 86 ms | 88 ms | 85 ms | 104 ms | 84 ms |
| session state loaded | 86 ms | 88 ms | 86 ms | 104 ms | 85 ms |
| extensions scanned | 81 ms | 82 ms | 81 ms | 98 ms | 79 ms |
| themes ready | 90 ms | 90 ms | 90 ms | 107 ms | 88 ms |
| DI container created | 94 ms | 95 ms | 94 ms | 110 ms | 91 ms |
| workbench mounted | 126 ms | 124 ms | 125 ms | 139 ms | 119 ms |
| first frame | 126 ms | 124 ms | 125 ms | 139 ms | 119 ms |
| workbench activated | 132 ms | 130 ms | 130 ms | 144 ms | 125 ms |
| grammars preloaded | 142 ms | 138 ms | 136 ms | 150 ms | 127 ms |
| file read from disk | 145 ms | 142 ms | 149 ms | 242 ms | 140 ms |
| file decoded | 145 ms | 142 ms | 149 ms | 242 ms | 140 ms |
| document built | 145 ms | 142 ms | 150 ms | 242 ms | 140 ms |
| tokenizer attached to editor | 164 ms | 164 ms | 176 ms | 266 ms | — |
| tabs opened | 148 ms | 148 ms | 160 ms | 251 ms | 158 ms |
| built-in extensions registered | 307 ms | 303 ms | 313 ms | 381 ms | 209 ms |
| frame with file text | 162 ms | 163 ms | 174 ms | 264 ms | 171 ms |
| frame with highlighting | 284 ms | 278 ms | 294 ms | 363 ms | — |
| extension host up | 530 ms | 559 ms | 611 ms | 932 ms | 389 ms |
| startup complete | 302 ms | 297 ms | 309 ms | 377 ms | 203 ms |
| to text (black box) | 165 ms | 164 ms | 176 ms | 264 ms | 171 ms |
| to highlight (black box) | 284 ms | 280 ms | 294 ms | 363 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 36 ms | 10 ms | 9 ms | 8 ms | 17 ms | 7 ms | 5 ms |
| `medium` | 31 ms | 14 ms | 12 ms | 11 ms | 14 ms | 7 ms | 6 ms |
| `large` | 37 ms | 22 ms | 17 ms | 24 ms | 45 ms | 16 ms | 15 ms |
| `xlarge` | 28 ms | 20 ms | 9 ms | 13 ms | 102 ms | 12 ms | 79 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
