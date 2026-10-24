# File open benchmark

- Recorded: 2026-10-24T17:18:24.592Z, commit `d5e36bcdb8fe`, diode nightly-d5e36bc
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 24 ms; binary floor (`diode --version` over PTY, median): 59 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **140 ms** | 104 ms | 164 ms | 282 ms | 12 ms | 242 MB | 11 |
| `medium` | 126.7 KB | 2000 | **147 ms** | 111 ms | 170 ms | 285 ms | 9 ms | 266 MB | 11 |
| `large` | 1.3 MB | 20000 | **161 ms** | 125 ms | 185 ms | 300 ms | 9 ms | 285 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **240 ms** | 204 ms | 263 ms | 368 ms | 9 ms | 349 MB | 5 |
| `log500m` | 497 MB | 5295839 | **150 ms** | 114 ms | 173 ms | — (plaintext) | 2 ms | 294 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 7 ms | 9 ms | 6 ms |
| node ready (bootstrapComplete) | 65 ms | 67 ms | 71 ms | 77 ms | 61 ms |
| bundle executed (main:start) | 65 ms | 67 ms | 71 ms | 77 ms | 61 ms |
| config loaded | 82 ms | 86 ms | 90 ms | 95 ms | 82 ms |
| keybindings loaded | 83 ms | 86 ms | 91 ms | 95 ms | 84 ms |
| session state loaded | 83 ms | 86 ms | 91 ms | 95 ms | 84 ms |
| extensions scanned | 79 ms | 82 ms | 85 ms | 93 ms | 79 ms |
| themes ready | 87 ms | 90 ms | 95 ms | 100 ms | 87 ms |
| DI container created | 91 ms | 94 ms | 99 ms | 105 ms | 91 ms |
| workbench mounted | 124 ms | 129 ms | 130 ms | 137 ms | 120 ms |
| first frame | 124 ms | 129 ms | 130 ms | 137 ms | 120 ms |
| workbench activated | 130 ms | 135 ms | 139 ms | 143 ms | 126 ms |
| grammars preloaded | 141 ms | 143 ms | 145 ms | 154 ms | 128 ms |
| file read from disk | 144 ms | 146 ms | 159 ms | 241 ms | 142 ms |
| file decoded | 144 ms | 146 ms | 159 ms | 241 ms | 142 ms |
| document built | 144 ms | 146 ms | 159 ms | 242 ms | 142 ms |
| tokenizer attached to editor | 164 ms | 170 ms | 186 ms | 265 ms | — |
| tabs opened | 148 ms | 153 ms | 169 ms | 251 ms | 162 ms |
| built-in extensions registered | 301 ms | 306 ms | 319 ms | 387 ms | 211 ms |
| frame with file text | 163 ms | 168 ms | 184 ms | 263 ms | 173 ms |
| frame with highlighting | 282 ms | 285 ms | 300 ms | 368 ms | — |
| extension host up | 540 ms | 558 ms | 629 ms | 957 ms | 396 ms |
| startup complete | 296 ms | 302 ms | 315 ms | 382 ms | 204 ms |
| to text (black box) | 164 ms | 170 ms | 185 ms | 263 ms | 173 ms |
| to highlight (black box) | 282 ms | 285 ms | 300 ms | 368 ms | — |
| gap black − white (text) | 2 ms | 1 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 35 ms | 12 ms | 8 ms | 9 ms | 14 ms | 6 ms | 4 ms |
| `medium` | 29 ms | 12 ms | 12 ms | 10 ms | 17 ms | 8 ms | 9 ms |
| `large` | 33 ms | 17 ms | 16 ms | 17 ms | 47 ms | 14 ms | 15 ms |
| `xlarge` | 30 ms | 22 ms | 13 ms | 14 ms | 108 ms | 12 ms | 77 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
