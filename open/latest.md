# File open benchmark

- Recorded: 2026-11-03T00:45:24.030Z, commit `fa6347b2bc67`, diode nightly-fa6347b
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 21 ms; binary floor (`diode --version` over PTY, median): 54 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **112 ms** | 79 ms | 133 ms | 224 ms | 10 ms | 272 MB | 11 |
| `medium` | 126.7 KB | 2000 | **114 ms** | 81 ms | 135 ms | 228 ms | 9 ms | 282 MB | 11 |
| `large` | 1.3 MB | 20000 | **127 ms** | 93 ms | 147 ms | 236 ms | 9 ms | 292 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **199 ms** | 165 ms | 219 ms | 302 ms | 12 ms | 348 MB | 5 |
| `log500m` | 497 MB | 5295839 | **120 ms** | 86 ms | 140 ms | — (plaintext) | 3 ms | 308 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 5 ms | 6 ms | 8 ms | 5 ms |
| node ready (bootstrapComplete) | 59 ms | 58 ms | 61 ms | 77 ms | 54 ms |
| bundle executed (main:start) | 59 ms | 58 ms | 61 ms | 77 ms | 54 ms |
| config loaded | 75 ms | 73 ms | 77 ms | 90 ms | 70 ms |
| keybindings loaded | 75 ms | 74 ms | 78 ms | 90 ms | 70 ms |
| session state loaded | 75 ms | 74 ms | 78 ms | 90 ms | 71 ms |
| extensions scanned | 71 ms | 70 ms | 73 ms | 86 ms | 66 ms |
| themes ready | 78 ms | 77 ms | 80 ms | 96 ms | 76 ms |
| DI container created | 82 ms | 81 ms | 84 ms | 98 ms | 79 ms |
| workbench mounted | 106 ms | 106 ms | 106 ms | 126 ms | 102 ms |
| first frame | 106 ms | 106 ms | 106 ms | 126 ms | 102 ms |
| workbench activated | 110 ms | 109 ms | 110 ms | 130 ms | 106 ms |
| grammars preloaded | 114 ms | 114 ms | 115 ms | 139 ms | 107 ms |
| file read from disk | 116 ms | 118 ms | 128 ms | 199 ms | 116 ms |
| file decoded | 116 ms | 118 ms | 128 ms | 199 ms | 116 ms |
| document built | 116 ms | 118 ms | 128 ms | 199 ms | 116 ms |
| tokenizer attached to editor | 134 ms | 135 ms | 149 ms | 220 ms | — |
| tabs opened | 120 ms | 122 ms | 135 ms | 207 ms | 130 ms |
| built-in extensions registered | 244 ms | 247 ms | 254 ms | 320 ms | 172 ms |
| frame with file text | 132 ms | 133 ms | 147 ms | 218 ms | 140 ms |
| frame with highlighting | 224 ms | 228 ms | 235 ms | 302 ms | — |
| extension host up | 435 ms | 461 ms | 523 ms | 900 ms | 320 ms |
| startup complete | 239 ms | 242 ms | 249 ms | 315 ms | 166 ms |
| to text (black box) | 133 ms | 135 ms | 147 ms | 219 ms | 140 ms |
| to highlight (black box) | 224 ms | 228 ms | 236 ms | 302 ms | — |
| gap black − white (text) | 1 ms | 3 ms | 2 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 28 ms | 10 ms | 7 ms | 7 ms | — | 4 ms | 3 ms |
| `medium` failed | 26 ms | 11 ms | 8 ms | 8 ms | — | 5 ms | 4 ms |
| `large` failed | 28 ms | 27 ms | 16 ms | 14 ms | — | 12 ms | 14 ms |
| `xlarge` failed | 29 ms | 28 ms | 17 ms | 20 ms | — | 12 ms | 75 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
