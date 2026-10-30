# File open benchmark

- Recorded: 2026-10-30T13:03:26.185Z, commit `3e0482747bab`, diode nightly-3e04827
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 27 ms; binary floor (`diode --version` over PTY, median): 65 ms; for reference `node --version`: 5 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **153 ms** | 115 ms | 180 ms | 302 ms | 12 ms | 252 MB | 11 |
| `medium` | 126.7 KB | 2000 | **155 ms** | 117 ms | 181 ms | 310 ms | 8 ms | 281 MB | 11 |
| `large` | 1.3 MB | 20000 | **173 ms** | 134 ms | 199 ms | 335 ms | 11 ms | 296 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **255 ms** | 217 ms | 282 ms | 415 ms | 6 ms | 366 MB | 5 |
| `log500m` | 497 MB | 5295839 | **165 ms** | 127 ms | 192 ms | — (plaintext) | 4 ms | 300 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 9 ms | 10 ms | 7 ms |
| node ready (bootstrapComplete) | 72 ms | 72 ms | 76 ms | 82 ms | 67 ms |
| bundle executed (main:start) | 72 ms | 72 ms | 76 ms | 82 ms | 67 ms |
| config loaded | 91 ms | 90 ms | 98 ms | 98 ms | 93 ms |
| keybindings loaded | 92 ms | 90 ms | 98 ms | 99 ms | 93 ms |
| session state loaded | 93 ms | 90 ms | 98 ms | 99 ms | 93 ms |
| extensions scanned | 88 ms | 87 ms | 94 ms | 94 ms | 88 ms |
| themes ready | 97 ms | 95 ms | 103 ms | 105 ms | 96 ms |
| DI container created | 103 ms | 100 ms | 108 ms | 111 ms | 100 ms |
| workbench mounted | 138 ms | 137 ms | 139 ms | 150 ms | 131 ms |
| first frame | 138 ms | 136 ms | 139 ms | 150 ms | 131 ms |
| workbench activated | 149 ms | 147 ms | 149 ms | 159 ms | 137 ms |
| grammars preloaded | 154 ms | 153 ms | 155 ms | 165 ms | 139 ms |
| file read from disk | 157 ms | 157 ms | 174 ms | 256 ms | 152 ms |
| file decoded | 157 ms | 157 ms | 174 ms | 256 ms | 152 ms |
| document built | 157 ms | 157 ms | 174 ms | 257 ms | 152 ms |
| tokenizer attached to editor | 180 ms | 188 ms | 216 ms | 298 ms | — |
| tabs opened | 162 ms | 164 ms | 186 ms | 267 ms | 175 ms |
| built-in extensions registered | 328 ms | 336 ms | 359 ms | 439 ms | 234 ms |
| frame with file text | 178 ms | 180 ms | 199 ms | 282 ms | 191 ms |
| frame with highlighting | 302 ms | 308 ms | 335 ms | 415 ms | — |
| extension host up | 576 ms | 616 ms | 690 ms | 1120 ms | 441 ms |
| startup complete | 322 ms | 329 ms | 353 ms | 433 ms | 227 ms |
| to text (black box) | 180 ms | 181 ms | 199 ms | 282 ms | 192 ms |
| to highlight (black box) | 302 ms | 310 ms | 335 ms | 415 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 0 ms | 0 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 39 ms | 16 ms | 11 ms | 9 ms | 17 ms | 9 ms | 4 ms |
| `medium` | 34 ms | 13 ms | 12 ms | 12 ms | 18 ms | 8 ms | 5 ms |
| `large` | 34 ms | 30 ms | 17 ms | 17 ms | 44 ms | 13 ms | 15 ms |
| `xlarge` | 32 ms | 26 ms | 18 ms | 16 ms | 109 ms | 13 ms | 85 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
