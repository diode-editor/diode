# File open benchmark

- Recorded: 2026-10-25T12:35:58.854Z, commit `f8588eabdad1`, diode nightly-f8588ea
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 24 ms; binary floor (`diode --version` over PTY, median): 59 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **130 ms** | 95 ms | 154 ms | 275 ms | 18 ms | 249 MB | 11 |
| `medium` | 126.7 KB | 2000 | **140 ms** | 104 ms | 163 ms | 279 ms | 6 ms | 246 MB | 11 |
| `large` | 1.3 MB | 20000 | **152 ms** | 116 ms | 175 ms | 289 ms | 14 ms | 285 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **243 ms** | 207 ms | 266 ms | 366 ms | 4 ms | 351 MB | 5 |
| `log500m` | 497 MB | 5295839 | **156 ms** | 120 ms | 180 ms | — (plaintext) | 4 ms | 262 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 7 ms | 7 ms | 9 ms | 6 ms |
| node ready (bootstrapComplete) | 64 ms | 65 ms | 67 ms | 79 ms | 62 ms |
| bundle executed (main:start) | 64 ms | 65 ms | 67 ms | 79 ms | 62 ms |
| config loaded | 82 ms | 80 ms | 86 ms | 98 ms | 77 ms |
| keybindings loaded | 83 ms | 81 ms | 86 ms | 99 ms | 77 ms |
| session state loaded | 83 ms | 81 ms | 86 ms | 99 ms | 77 ms |
| extensions scanned | 78 ms | 77 ms | 82 ms | 94 ms | 73 ms |
| themes ready | 86 ms | 86 ms | 90 ms | 103 ms | 82 ms |
| DI container created | 90 ms | 90 ms | 94 ms | 108 ms | 86 ms |
| workbench mounted | 119 ms | 123 ms | 125 ms | 136 ms | 120 ms |
| first frame | 119 ms | 123 ms | 125 ms | 136 ms | 120 ms |
| workbench activated | 125 ms | 128 ms | 131 ms | 141 ms | 125 ms |
| grammars preloaded | 135 ms | 139 ms | 141 ms | 148 ms | 132 ms |
| file read from disk | 137 ms | 142 ms | 153 ms | 245 ms | 147 ms |
| file decoded | 137 ms | 142 ms | 153 ms | 245 ms | 147 ms |
| document built | 137 ms | 143 ms | 154 ms | 245 ms | 147 ms |
| tokenizer attached to editor | 154 ms | 164 ms | 176 ms | 268 ms | — |
| tabs opened | 141 ms | 148 ms | 162 ms | 254 ms | 165 ms |
| built-in extensions registered | 296 ms | 301 ms | 310 ms | 383 ms | 214 ms |
| frame with file text | 153 ms | 162 ms | 175 ms | 266 ms | 177 ms |
| frame with highlighting | 274 ms | 279 ms | 289 ms | 366 ms | — |
| extension host up | 508 ms | 546 ms | 617 ms | 937 ms | 386 ms |
| startup complete | 292 ms | 296 ms | 305 ms | 379 ms | 209 ms |
| to text (black box) | 154 ms | 163 ms | 175 ms | 266 ms | 180 ms |
| to highlight (black box) | 275 ms | 279 ms | 289 ms | 366 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 0 ms | 0 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 36 ms | 12 ms | 10 ms | 13 ms | 14 ms | 7 ms | 4 ms |
| `medium` | 36 ms | 11 ms | 10 ms | 8 ms | 17 ms | 7 ms | 6 ms |
| `large` | 35 ms | 21 ms | 20 ms | 17 ms | 43 ms | 12 ms | 17 ms |
| `xlarge` | 32 ms | 15 ms | 9 ms | 10 ms | 97 ms | 14 ms | 77 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
