# File open benchmark

- Recorded: 2026-10-26T08:37:04.981Z, commit `1bb091f318db`, diode nightly-1bb091f
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 24 ms; binary floor (`diode --version` over PTY, median): 60 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **138 ms** | 103 ms | 162 ms | 281 ms | 16 ms | 257 MB | 11 |
| `medium` | 126.7 KB | 2000 | **137 ms** | 102 ms | 161 ms | 276 ms | 8 ms | 277 MB | 11 |
| `large` | 1.3 MB | 20000 | **155 ms** | 119 ms | 179 ms | 292 ms | 7 ms | 295 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **237 ms** | 201 ms | 261 ms | 363 ms | 11 ms | 365 MB | 5 |
| `log500m` | 497 MB | 5295839 | **157 ms** | 121 ms | 181 ms | — (plaintext) | 5 ms | 271 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 6 ms | 8 ms | 6 ms |
| node ready (bootstrapComplete) | 65 ms | 63 ms | 68 ms | 72 ms | 63 ms |
| bundle executed (main:start) | 65 ms | 63 ms | 68 ms | 72 ms | 63 ms |
| config loaded | 87 ms | 81 ms | 87 ms | 91 ms | 77 ms |
| keybindings loaded | 88 ms | 83 ms | 88 ms | 92 ms | 78 ms |
| session state loaded | 88 ms | 83 ms | 88 ms | 92 ms | 78 ms |
| extensions scanned | 82 ms | 78 ms | 83 ms | 87 ms | 74 ms |
| themes ready | 92 ms | 88 ms | 91 ms | 98 ms | 84 ms |
| DI container created | 96 ms | 92 ms | 95 ms | 101 ms | 89 ms |
| workbench mounted | 128 ms | 123 ms | 127 ms | 134 ms | 122 ms |
| first frame | 128 ms | 123 ms | 127 ms | 134 ms | 122 ms |
| workbench activated | 133 ms | 130 ms | 136 ms | 144 ms | 129 ms |
| grammars preloaded | 139 ms | 138 ms | 141 ms | 149 ms | 135 ms |
| file read from disk | 142 ms | 142 ms | 154 ms | 235 ms | 146 ms |
| file decoded | 142 ms | 142 ms | 154 ms | 235 ms | 146 ms |
| document built | 142 ms | 142 ms | 154 ms | 235 ms | 147 ms |
| tokenizer attached to editor | 162 ms | 163 ms | 179 ms | 260 ms | — |
| tabs opened | 146 ms | 148 ms | 162 ms | 245 ms | 167 ms |
| built-in extensions registered | 303 ms | 297 ms | 313 ms | 383 ms | 222 ms |
| frame with file text | 161 ms | 161 ms | 178 ms | 258 ms | 181 ms |
| frame with highlighting | 281 ms | 275 ms | 292 ms | 362 ms | — |
| extension host up | 562 ms | 568 ms | 634 ms | 942 ms | 399 ms |
| startup complete | 297 ms | 291 ms | 307 ms | 378 ms | 215 ms |
| to text (black box) | 162 ms | 161 ms | 179 ms | 261 ms | 181 ms |
| to highlight (black box) | 281 ms | 276 ms | 292 ms | 363 ms | — |
| gap black − white (text) | 0 ms | 1 ms | 1 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 36 ms | 12 ms | 12 ms | 9 ms | 20 ms | 6 ms | 4 ms |
| `medium` | 33 ms | 14 ms | 11 ms | 7 ms | 14 ms | 5 ms | 4 ms |
| `large` | 34 ms | 19 ms | 19 ms | 14 ms | 41 ms | 20 ms | 18 ms |
| `xlarge` | 30 ms | 27 ms | 14 ms | 12 ms | 98 ms | 9 ms | 76 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
