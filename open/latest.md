# File open benchmark

- Recorded: 2026-11-26T00:24:23.464Z, commit `0fcef8b591fe`, diode nightly-0fcef8b
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1020-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 21 ms; binary floor (`diode --version` over PTY, median): 62 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **145 ms** | 104 ms | 166 ms | 250 ms | 9 ms | 288 MB | 11 |
| `medium` | 126.7 KB | 2000 | **142 ms** | 101 ms | 163 ms | 253 ms | 5 ms | 303 MB | 11 |
| `large` | 1.3 MB | 20000 | **158 ms** | 117 ms | 179 ms | 270 ms | 9 ms | 315 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **221 ms** | 180 ms | 242 ms | 317 ms | 10 ms | 369 MB | 5 |
| `log500m` | 497 MB | 5295839 | **152 ms** | 111 ms | 173 ms | — (plaintext) | 2 ms | 326 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 7 ms | 6 ms | 9 ms | 5 ms |
| node ready (bootstrapComplete) | 68 ms | 68 ms | 72 ms | 82 ms | 62 ms |
| bundle executed (main:start) | 68 ms | 68 ms | 72 ms | 82 ms | 62 ms |
| config loaded | 86 ms | 88 ms | 89 ms | 97 ms | 78 ms |
| keybindings loaded | 86 ms | 90 ms | 92 ms | 99 ms | 79 ms |
| session state loaded | 86 ms | 90 ms | 92 ms | 99 ms | 79 ms |
| extensions scanned | 81 ms | 83 ms | 85 ms | 94 ms | 74 ms |
| themes ready | 91 ms | 93 ms | 95 ms | 103 ms | 83 ms |
| DI container created | 94 ms | 96 ms | 98 ms | 106 ms | 87 ms |
| workbench mounted | 133 ms | 130 ms | 137 ms | 146 ms | 125 ms |
| first frame | 133 ms | 130 ms | 137 ms | 146 ms | 125 ms |
| workbench activated | 142 ms | 136 ms | 143 ms | 151 ms | 137 ms |
| grammars preloaded | 146 ms | 140 ms | 148 ms | 156 ms | 138 ms |
| file read from disk | 149 ms | 144 ms | 157 ms | 221 ms | 146 ms |
| file decoded | 149 ms | 144 ms | 157 ms | 221 ms | 146 ms |
| document built | 149 ms | 144 ms | 157 ms | 221 ms | 147 ms |
| tokenizer attached to editor | 166 ms | 164 ms | 178 ms | 244 ms | — |
| tabs opened | 152 ms | 150 ms | 164 ms | 230 ms | 162 ms |
| built-in extensions registered | 277 ms | 280 ms | 296 ms | 344 ms | 210 ms |
| frame with file text | 165 ms | 162 ms | 176 ms | 242 ms | 172 ms |
| frame with highlighting | 250 ms | 253 ms | 270 ms | 317 ms | — |
| extension host up | 479 ms | 514 ms | 582 ms | 942 ms | 372 ms |
| startup complete | 267 ms | 270 ms | 287 ms | 333 ms | 199 ms |
| to text (black box) | 166 ms | 163 ms | 179 ms | 242 ms | 173 ms |
| to highlight (black box) | 250 ms | 253 ms | 270 ms | 317 ms | — |
| gap black − white (text) | 0 ms | 1 ms | 2 ms | 0 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 27 ms | 10 ms | 8 ms | 10 ms | — | 6 ms | 3 ms |
| `medium` failed | 26 ms | 17 ms | 10 ms | 10 ms | — | 5 ms | 5 ms |
| `large` failed | 27 ms | 24 ms | 24 ms | 19 ms | — | 17 ms | 15 ms |
| `xlarge` failed | 28 ms | 30 ms | 16 ms | 21 ms | — | 13 ms | 66 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
