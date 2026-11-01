# File open benchmark

- Recorded: 2026-11-01T07:35:53.265Z, commit `d70b78443dbd`, diode nightly-d70b784
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 20 ms; binary floor (`diode --version` over PTY, median): 53 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **115 ms** | 82 ms | 135 ms | 221 ms | 7 ms | 255 MB | 11 |
| `medium` | 126.7 KB | 2000 | **115 ms** | 82 ms | 135 ms | 225 ms | 4 ms | 281 MB | 11 |
| `large` | 1.3 MB | 20000 | **124 ms** | 91 ms | 144 ms | 247 ms | 9 ms | 298 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **197 ms** | 164 ms | 217 ms | 319 ms | 19 ms | 368 MB | 5 |
| `log500m` | 497 MB | 5295839 | **121 ms** | 89 ms | 142 ms | — (plaintext) | 10 ms | 269 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 6 ms | 7 ms | 5 ms |
| node ready (bootstrapComplete) | 56 ms | 58 ms | 59 ms | 74 ms | 56 ms |
| bundle executed (main:start) | 56 ms | 58 ms | 59 ms | 74 ms | 56 ms |
| config loaded | 71 ms | 73 ms | 71 ms | 90 ms | 72 ms |
| keybindings loaded | 71 ms | 73 ms | 71 ms | 90 ms | 72 ms |
| session state loaded | 71 ms | 73 ms | 71 ms | 90 ms | 72 ms |
| extensions scanned | 68 ms | 70 ms | 69 ms | 87 ms | 69 ms |
| themes ready | 75 ms | 78 ms | 77 ms | 93 ms | 76 ms |
| DI container created | 79 ms | 80 ms | 79 ms | 97 ms | 80 ms |
| workbench mounted | 103 ms | 103 ms | 104 ms | 121 ms | 102 ms |
| first frame | 103 ms | 103 ms | 104 ms | 121 ms | 102 ms |
| workbench activated | 108 ms | 107 ms | 108 ms | 124 ms | 106 ms |
| grammars preloaded | 116 ms | 114 ms | 117 ms | 129 ms | 108 ms |
| file read from disk | 118 ms | 117 ms | 126 ms | 198 ms | 117 ms |
| file decoded | 118 ms | 117 ms | 126 ms | 198 ms | 117 ms |
| document built | 118 ms | 117 ms | 126 ms | 198 ms | 117 ms |
| tokenizer attached to editor | 134 ms | 138 ms | 159 ms | 234 ms | — |
| tabs opened | 121 ms | 122 ms | 132 ms | 207 ms | 131 ms |
| built-in extensions registered | 241 ms | 246 ms | 265 ms | 337 ms | 174 ms |
| frame with file text | 133 ms | 132 ms | 143 ms | 217 ms | 140 ms |
| frame with highlighting | 221 ms | 225 ms | 247 ms | 319 ms | — |
| extension host up | 423 ms | 457 ms | 523 ms | 869 ms | 314 ms |
| startup complete | 236 ms | 241 ms | 261 ms | 332 ms | 169 ms |
| to text (black box) | 135 ms | 135 ms | 144 ms | 217 ms | 142 ms |
| to highlight (black box) | 221 ms | 225 ms | 247 ms | 319 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 1 ms | 2 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 22 ms | 7 ms | 9 ms | 7 ms | 13 ms | 5 ms | 2 ms |
| `medium` | 22 ms | 11 ms | 12 ms | 9 ms | 16 ms | 8 ms | 3 ms |
| `large` | 33 ms | 20 ms | 15 ms | 17 ms | 41 ms | 11 ms | 13 ms |
| `xlarge` | 22 ms | 26 ms | 17 ms | 17 ms | 171 ms | 11 ms | 55 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
