# File open benchmark

- Recorded: 2026-10-26T12:36:56.343Z, commit `67a879927aaf`, diode nightly-67a8799
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 23 ms; binary floor (`diode --version` over PTY, median): 52 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **109 ms** | 80 ms | 132 ms | 221 ms | 5 ms | 255 MB | 11 |
| `medium` | 126.7 KB | 2000 | **111 ms** | 82 ms | 134 ms | 222 ms | 5 ms | 280 MB | 11 |
| `large` | 1.3 MB | 20000 | **123 ms** | 94 ms | 146 ms | 229 ms | 11 ms | 295 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **196 ms** | 167 ms | 219 ms | 296 ms | 6 ms | 369 MB | 5 |
| `log500m` | 497 MB | 5295839 | **116 ms** | 87 ms | 139 ms | — (plaintext) | 4 ms | 269 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 6 ms | 8 ms | 5 ms |
| node ready (bootstrapComplete) | 56 ms | 58 ms | 59 ms | 71 ms | 52 ms |
| bundle executed (main:start) | 56 ms | 58 ms | 59 ms | 71 ms | 52 ms |
| config loaded | 72 ms | 73 ms | 75 ms | 89 ms | 66 ms |
| keybindings loaded | 72 ms | 73 ms | 75 ms | 89 ms | 66 ms |
| session state loaded | 72 ms | 73 ms | 75 ms | 89 ms | 66 ms |
| extensions scanned | 68 ms | 70 ms | 72 ms | 85 ms | 64 ms |
| themes ready | 75 ms | 77 ms | 78 ms | 92 ms | 70 ms |
| DI container created | 78 ms | 80 ms | 82 ms | 94 ms | 74 ms |
| workbench mounted | 102 ms | 104 ms | 106 ms | 116 ms | 98 ms |
| first frame | 102 ms | 104 ms | 106 ms | 116 ms | 98 ms |
| workbench activated | 106 ms | 108 ms | 110 ms | 120 ms | 102 ms |
| grammars preloaded | 113 ms | 115 ms | 114 ms | 124 ms | 107 ms |
| file read from disk | 115 ms | 117 ms | 127 ms | 197 ms | 116 ms |
| file decoded | 115 ms | 117 ms | 127 ms | 197 ms | 116 ms |
| document built | 115 ms | 117 ms | 128 ms | 198 ms | 116 ms |
| tokenizer attached to editor | 131 ms | 135 ms | 148 ms | 218 ms | — |
| tabs opened | 118 ms | 122 ms | 136 ms | 205 ms | 130 ms |
| built-in extensions registered | 238 ms | 240 ms | 245 ms | 313 ms | 167 ms |
| frame with file text | 130 ms | 133 ms | 145 ms | 217 ms | 139 ms |
| frame with highlighting | 220 ms | 222 ms | 229 ms | 296 ms | — |
| extension host up | 425 ms | 458 ms | 495 ms | 789 ms | 311 ms |
| startup complete | 233 ms | 235 ms | 240 ms | 308 ms | 161 ms |
| to text (black box) | 132 ms | 134 ms | 146 ms | 219 ms | 139 ms |
| to highlight (black box) | 221 ms | 222 ms | 229 ms | 296 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 1 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 28 ms | 9 ms | 6 ms | 8 ms | 12 ms | 5 ms | 3 ms |
| `medium` | 30 ms | 13 ms | 8 ms | 8 ms | 11 ms | 6 ms | 3 ms |
| `large` | 31 ms | 23 ms | 17 ms | 19 ms | 43 ms | 12 ms | 14 ms |
| `xlarge` | 23 ms | 23 ms | 13 ms | 17 ms | 130 ms | 9 ms | 63 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
