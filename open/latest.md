# File open benchmark

- Recorded: 2026-10-24T17:48:53.850Z, commit `1c8be06cfbde`, diode nightly-1c8be06
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 60 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **140 ms** | 105 ms | 165 ms | 275 ms | 10 ms | 244 MB | 11 |
| `medium` | 126.7 KB | 2000 | **137 ms** | 101 ms | 162 ms | 275 ms | 3 ms | 245 MB | 11 |
| `large` | 1.3 MB | 20000 | **156 ms** | 120 ms | 181 ms | 294 ms | 3 ms | 283 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **235 ms** | 200 ms | 260 ms | 360 ms | 10 ms | 348 MB | 5 |
| `log500m` | 497 MB | 5295839 | **145 ms** | 109 ms | 170 ms | — (plaintext) | 4 ms | 294 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 7 ms | 9 ms | 6 ms |
| node ready (bootstrapComplete) | 67 ms | 63 ms | 68 ms | 73 ms | 60 ms |
| bundle executed (main:start) | 67 ms | 63 ms | 68 ms | 73 ms | 60 ms |
| config loaded | 82 ms | 80 ms | 87 ms | 93 ms | 79 ms |
| keybindings loaded | 83 ms | 81 ms | 88 ms | 93 ms | 81 ms |
| session state loaded | 83 ms | 81 ms | 88 ms | 93 ms | 81 ms |
| extensions scanned | 79 ms | 77 ms | 83 ms | 87 ms | 76 ms |
| themes ready | 88 ms | 85 ms | 92 ms | 96 ms | 84 ms |
| DI container created | 93 ms | 89 ms | 96 ms | 99 ms | 87 ms |
| workbench mounted | 125 ms | 122 ms | 127 ms | 130 ms | 116 ms |
| first frame | 125 ms | 122 ms | 127 ms | 130 ms | 116 ms |
| workbench activated | 131 ms | 128 ms | 132 ms | 136 ms | 121 ms |
| grammars preloaded | 139 ms | 135 ms | 140 ms | 145 ms | 125 ms |
| file read from disk | 142 ms | 139 ms | 155 ms | 238 ms | 138 ms |
| file decoded | 142 ms | 139 ms | 155 ms | 238 ms | 138 ms |
| document built | 142 ms | 139 ms | 155 ms | 238 ms | 138 ms |
| tokenizer attached to editor | 165 ms | 163 ms | 180 ms | 262 ms | — |
| tabs opened | 147 ms | 146 ms | 164 ms | 247 ms | 157 ms |
| built-in extensions registered | 296 ms | 296 ms | 314 ms | 377 ms | 205 ms |
| frame with file text | 164 ms | 161 ms | 178 ms | 260 ms | 170 ms |
| frame with highlighting | 275 ms | 274 ms | 294 ms | 360 ms | — |
| extension host up | 527 ms | 535 ms | 619 ms | 915 ms | 385 ms |
| startup complete | 291 ms | 291 ms | 309 ms | 373 ms | 200 ms |
| to text (black box) | 165 ms | 162 ms | 181 ms | 260 ms | 170 ms |
| to highlight (black box) | 275 ms | 275 ms | 294 ms | 360 ms | — |
| gap black − white (text) | 1 ms | 0 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 37 ms | 13 ms | 9 ms | 11 ms | 18 ms | 7 ms | 3 ms |
| `medium` | 30 ms | 13 ms | 8 ms | 9 ms | 16 ms | 7 ms | 7 ms |
| `large` | 33 ms | 20 ms | 16 ms | 16 ms | 39 ms | 14 ms | 17 ms |
| `xlarge` | 26 ms | 15 ms | 10 ms | 13 ms | 99 ms | 8 ms | 91 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
