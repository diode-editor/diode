# File open benchmark

- Recorded: 2026-11-01T12:15:18.620Z, commit `ee02d3cdc561`, diode nightly-ee02d3c
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 20 ms; binary floor (`diode --version` over PTY, median): 52 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **115 ms** | 82 ms | 134 ms | 220 ms | 6 ms | 256 MB | 11 |
| `medium` | 126.7 KB | 2000 | **115 ms** | 82 ms | 134 ms | 225 ms | 6 ms | 280 MB | 11 |
| `large` | 1.3 MB | 20000 | **125 ms** | 92 ms | 144 ms | 243 ms | 6 ms | 292 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **196 ms** | 164 ms | 216 ms | 326 ms | 6 ms | 362 MB | 5 |
| `log500m` | 497 MB | 5295839 | **125 ms** | 93 ms | 145 ms | — (plaintext) | 7 ms | 273 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 6 ms | 6 ms | 7 ms | 5 ms |
| node ready (bootstrapComplete) | 56 ms | 58 ms | 58 ms | 65 ms | 53 ms |
| bundle executed (main:start) | 56 ms | 58 ms | 58 ms | 65 ms | 53 ms |
| config loaded | 72 ms | 75 ms | 73 ms | 90 ms | 68 ms |
| keybindings loaded | 73 ms | 76 ms | 74 ms | 90 ms | 68 ms |
| session state loaded | 73 ms | 76 ms | 74 ms | 90 ms | 68 ms |
| extensions scanned | 69 ms | 71 ms | 70 ms | 84 ms | 65 ms |
| themes ready | 76 ms | 78 ms | 77 ms | 94 ms | 72 ms |
| DI container created | 79 ms | 81 ms | 80 ms | 97 ms | 75 ms |
| workbench mounted | 103 ms | 104 ms | 103 ms | 119 ms | 100 ms |
| first frame | 103 ms | 104 ms | 103 ms | 119 ms | 100 ms |
| workbench activated | 107 ms | 108 ms | 107 ms | 123 ms | 104 ms |
| grammars preloaded | 116 ms | 113 ms | 116 ms | 127 ms | 110 ms |
| file read from disk | 118 ms | 116 ms | 125 ms | 197 ms | 121 ms |
| file decoded | 118 ms | 116 ms | 125 ms | 197 ms | 121 ms |
| document built | 118 ms | 117 ms | 125 ms | 197 ms | 121 ms |
| tokenizer attached to editor | 134 ms | 139 ms | 159 ms | 233 ms | — |
| tabs opened | 121 ms | 122 ms | 132 ms | 204 ms | 135 ms |
| built-in extensions registered | 239 ms | 246 ms | 262 ms | 343 ms | 175 ms |
| frame with file text | 133 ms | 132 ms | 142 ms | 216 ms | 145 ms |
| frame with highlighting | 219 ms | 225 ms | 243 ms | 326 ms | — |
| extension host up | 424 ms | 457 ms | 509 ms | 902 ms | 321 ms |
| startup complete | 234 ms | 241 ms | 257 ms | 338 ms | 169 ms |
| to text (black box) | 134 ms | 134 ms | 144 ms | 216 ms | 145 ms |
| to highlight (black box) | 220 ms | 225 ms | 243 ms | 326 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 2 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 24 ms | 9 ms | 8 ms | 8 ms | 15 ms | 7 ms | 3 ms |
| `medium` | 28 ms | 11 ms | 7 ms | 8 ms | 17 ms | 5 ms | 4 ms |
| `large` | 39 ms | 16 ms | 19 ms | 18 ms | 37 ms | 10 ms | 13 ms |
| `xlarge` | 29 ms | 32 ms | 15 ms | 19 ms | 174 ms | 14 ms | 48 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
