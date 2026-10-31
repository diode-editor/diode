# File open benchmark

- Recorded: 2026-10-31T04:00:56.704Z, commit `ea9b5c7d743e`, diode nightly-ea9b5c7
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 63 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **142 ms** | 104 ms | 167 ms | 283 ms | 6 ms | 260 MB | 11 |
| `medium` | 126.7 KB | 2000 | **144 ms** | 106 ms | 169 ms | 289 ms | 14 ms | 279 MB | 11 |
| `large` | 1.3 MB | 20000 | **160 ms** | 122 ms | 185 ms | 321 ms | 2 ms | 294 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **245 ms** | 207 ms | 270 ms | 402 ms | 3 ms | 370 MB | 5 |
| `log500m` | 497 MB | 5295839 | **162 ms** | 125 ms | 188 ms | — (plaintext) | 0 ms | 268 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 7 ms | 10 ms | 6 ms |
| node ready (bootstrapComplete) | 66 ms | 68 ms | 68 ms | 81 ms | 63 ms |
| bundle executed (main:start) | 66 ms | 68 ms | 68 ms | 81 ms | 63 ms |
| config loaded | 88 ms | 84 ms | 86 ms | 99 ms | 80 ms |
| keybindings loaded | 89 ms | 86 ms | 88 ms | 100 ms | 81 ms |
| session state loaded | 90 ms | 86 ms | 88 ms | 100 ms | 81 ms |
| extensions scanned | 86 ms | 79 ms | 83 ms | 95 ms | 76 ms |
| themes ready | 93 ms | 91 ms | 94 ms | 105 ms | 86 ms |
| DI container created | 96 ms | 96 ms | 98 ms | 109 ms | 90 ms |
| workbench mounted | 129 ms | 128 ms | 130 ms | 145 ms | 126 ms |
| first frame | 129 ms | 128 ms | 130 ms | 145 ms | 126 ms |
| workbench activated | 135 ms | 137 ms | 139 ms | 149 ms | 137 ms |
| grammars preloaded | 141 ms | 144 ms | 146 ms | 155 ms | 139 ms |
| file read from disk | 144 ms | 148 ms | 159 ms | 245 ms | 152 ms |
| file decoded | 144 ms | 148 ms | 159 ms | 245 ms | 152 ms |
| document built | 144 ms | 148 ms | 159 ms | 246 ms | 152 ms |
| tokenizer attached to editor | 167 ms | 175 ms | 202 ms | 285 ms | — |
| tabs opened | 148 ms | 154 ms | 170 ms | 256 ms | 172 ms |
| built-in extensions registered | 312 ms | 316 ms | 344 ms | 426 ms | 232 ms |
| frame with file text | 165 ms | 169 ms | 185 ms | 269 ms | 186 ms |
| frame with highlighting | 283 ms | 289 ms | 321 ms | 402 ms | — |
| extension host up | 557 ms | 596 ms | 655 ms | 1083 ms | 415 ms |
| startup complete | 305 ms | 309 ms | 339 ms | 420 ms | 223 ms |
| to text (black box) | 167 ms | 169 ms | 185 ms | 270 ms | 188 ms |
| to highlight (black box) | 283 ms | 289 ms | 321 ms | 402 ms | — |
| gap black − white (text) | 2 ms | 1 ms | 0 ms | 0 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 33 ms | 14 ms | 12 ms | 11 ms | 17 ms | 8 ms | 4 ms |
| `medium` | 30 ms | 14 ms | 12 ms | 11 ms | 15 ms | 7 ms | 5 ms |
| `large` | 33 ms | 23 ms | 17 ms | 14 ms | 39 ms | 14 ms | 16 ms |
| `xlarge` | 28 ms | 16 ms | 8 ms | 11 ms | 95 ms | 12 ms | 99 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
