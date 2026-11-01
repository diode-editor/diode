# File open benchmark

- Recorded: 2026-11-01T11:39:26.315Z, commit `03481cf9038c`, diode nightly-03481cf
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 23 ms; binary floor (`diode --version` over PTY, median): 61 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **140 ms** | 102 ms | 163 ms | 277 ms | 7 ms | 255 MB | 11 |
| `medium` | 126.7 KB | 2000 | **142 ms** | 104 ms | 165 ms | 287 ms | 5 ms | 281 MB | 11 |
| `large` | 1.3 MB | 20000 | **155 ms** | 117 ms | 178 ms | 312 ms | 7 ms | 296 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **268 ms** | 230 ms | 292 ms | 415 ms | 20 ms | 364 MB | 5 |
| `log500m` | 497 MB | 5295839 | **156 ms** | 118 ms | 180 ms | — (plaintext) | 3 ms | 272 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 8 ms | 10 ms | 6 ms |
| node ready (bootstrapComplete) | 65 ms | 65 ms | 70 ms | 86 ms | 64 ms |
| bundle executed (main:start) | 65 ms | 65 ms | 70 ms | 87 ms | 64 ms |
| config loaded | 85 ms | 83 ms | 90 ms | 109 ms | 81 ms |
| keybindings loaded | 85 ms | 85 ms | 90 ms | 109 ms | 81 ms |
| session state loaded | 85 ms | 85 ms | 90 ms | 109 ms | 81 ms |
| extensions scanned | 80 ms | 80 ms | 84 ms | 106 ms | 78 ms |
| themes ready | 88 ms | 88 ms | 95 ms | 112 ms | 86 ms |
| DI container created | 93 ms | 92 ms | 99 ms | 116 ms | 90 ms |
| workbench mounted | 125 ms | 125 ms | 129 ms | 148 ms | 125 ms |
| first frame | 125 ms | 125 ms | 129 ms | 148 ms | 125 ms |
| workbench activated | 131 ms | 130 ms | 134 ms | 153 ms | 130 ms |
| grammars preloaded | 141 ms | 137 ms | 139 ms | 163 ms | 136 ms |
| file read from disk | 143 ms | 141 ms | 153 ms | 265 ms | 148 ms |
| file decoded | 143 ms | 141 ms | 153 ms | 265 ms | 148 ms |
| document built | 143 ms | 142 ms | 153 ms | 266 ms | 148 ms |
| tokenizer attached to editor | 164 ms | 171 ms | 195 ms | 308 ms | — |
| tabs opened | 147 ms | 148 ms | 163 ms | 278 ms | 166 ms |
| built-in extensions registered | 302 ms | 312 ms | 336 ms | 437 ms | 224 ms |
| frame with file text | 162 ms | 164 ms | 178 ms | 292 ms | 180 ms |
| frame with highlighting | 276 ms | 287 ms | 312 ms | 415 ms | — |
| extension host up | 531 ms | 583 ms | 655 ms | 1101 ms | 401 ms |
| startup complete | 296 ms | 305 ms | 329 ms | 432 ms | 218 ms |
| to text (black box) | 163 ms | 165 ms | 178 ms | 292 ms | 180 ms |
| to highlight (black box) | 277 ms | 287 ms | 312 ms | 415 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 33 ms | 15 ms | 9 ms | 9 ms | 21 ms | 8 ms | 3 ms |
| `medium` | 33 ms | 11 ms | 10 ms | 10 ms | 20 ms | 6 ms | 5 ms |
| `large` | 46 ms | 22 ms | 20 ms | 20 ms | 41 ms | 16 ms | 17 ms |
| `xlarge` | 36 ms | 21 ms | 12 ms | 12 ms | 102 ms | 9 ms | 79 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
