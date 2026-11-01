# File open benchmark

- Recorded: 2026-11-01T10:51:19.936Z, commit `ba94c8c00f07`, diode nightly-ba94c8c
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 63 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **149 ms** | 111 ms | 174 ms | 293 ms | 6 ms | 265 MB | 11 |
| `medium` | 126.7 KB | 2000 | **147 ms** | 109 ms | 171 ms | 290 ms | 3 ms | 280 MB | 11 |
| `large` | 1.3 MB | 20000 | **159 ms** | 121 ms | 184 ms | 320 ms | 6 ms | 295 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **259 ms** | 221 ms | 284 ms | 414 ms | 20 ms | 368 MB | 5 |
| `log500m` | 497 MB | 5295839 | **156 ms** | 118 ms | 181 ms | — (plaintext) | 7 ms | 271 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 6 ms | 7 ms | 10 ms | 6 ms |
| node ready (bootstrapComplete) | 69 ms | 68 ms | 72 ms | 91 ms | 64 ms |
| bundle executed (main:start) | 69 ms | 68 ms | 72 ms | 91 ms | 64 ms |
| config loaded | 86 ms | 88 ms | 92 ms | 106 ms | 80 ms |
| keybindings loaded | 89 ms | 89 ms | 92 ms | 107 ms | 80 ms |
| session state loaded | 89 ms | 89 ms | 92 ms | 107 ms | 80 ms |
| extensions scanned | 83 ms | 85 ms | 86 ms | 103 ms | 76 ms |
| themes ready | 93 ms | 94 ms | 97 ms | 115 ms | 85 ms |
| DI container created | 97 ms | 98 ms | 101 ms | 120 ms | 90 ms |
| workbench mounted | 133 ms | 129 ms | 132 ms | 155 ms | 123 ms |
| first frame | 133 ms | 129 ms | 132 ms | 155 ms | 123 ms |
| workbench activated | 142 ms | 135 ms | 138 ms | 162 ms | 128 ms |
| grammars preloaded | 148 ms | 141 ms | 143 ms | 167 ms | 135 ms |
| file read from disk | 151 ms | 145 ms | 156 ms | 258 ms | 147 ms |
| file decoded | 151 ms | 145 ms | 156 ms | 258 ms | 147 ms |
| document built | 151 ms | 145 ms | 156 ms | 258 ms | 147 ms |
| tokenizer attached to editor | 173 ms | 177 ms | 199 ms | 299 ms | — |
| tabs opened | 156 ms | 152 ms | 166 ms | 270 ms | 167 ms |
| built-in extensions registered | 318 ms | 314 ms | 343 ms | 436 ms | 224 ms |
| frame with file text | 171 ms | 169 ms | 182 ms | 283 ms | 181 ms |
| frame with highlighting | 293 ms | 289 ms | 320 ms | 413 ms | — |
| extension host up | 557 ms | 598 ms | 664 ms | 1101 ms | 426 ms |
| startup complete | 313 ms | 309 ms | 337 ms | 431 ms | 216 ms |
| to text (black box) | 174 ms | 171 ms | 184 ms | 284 ms | 181 ms |
| to highlight (black box) | 293 ms | 290 ms | 320 ms | 414 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 2 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 31 ms | 13 ms | 11 ms | 9 ms | 21 ms | 8 ms | 3 ms |
| `medium` | 33 ms | 13 ms | 10 ms | 10 ms | 20 ms | 6 ms | 5 ms |
| `large` | 39 ms | 20 ms | 21 ms | 22 ms | 43 ms | 17 ms | 14 ms |
| `xlarge` | 32 ms | 21 ms | 12 ms | 14 ms | 104 ms | 12 ms | 77 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
