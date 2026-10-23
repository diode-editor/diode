# File open benchmark

- Recorded: 2026-10-23T22:17:51.364Z, commit `7113f3c13a77`, diode nightly-7113f3c
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 22 ms; binary floor (`diode --version` over PTY, median): 51 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **107 ms** | 77 ms | 129 ms | 224 ms | 8 ms | 245 MB | 11 |
| `medium` | 126.7 KB | 2000 | **116 ms** | 86 ms | 138 ms | 228 ms | 8 ms | 266 MB | 11 |
| `large` | 1.3 MB | 20000 | **127 ms** | 97 ms | 148 ms | 239 ms | 5 ms | 287 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **195 ms** | 165 ms | 217 ms | 298 ms | 3 ms | 464 MB | 5 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` |
| --- | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 6 ms | 9 ms |
| node ready (bootstrapComplete) | 55 ms | 59 ms | 60 ms | 71 ms |
| bundle executed (main:start) | 55 ms | 59 ms | 60 ms | 71 ms |
| config loaded | 71 ms | 76 ms | 76 ms | 88 ms |
| keybindings loaded | 71 ms | 76 ms | 77 ms | 88 ms |
| session state loaded | 72 ms | 76 ms | 77 ms | 88 ms |
| extensions scanned | 68 ms | 74 ms | 74 ms | 86 ms |
| themes ready | 74 ms | 79 ms | 79 ms | 90 ms |
| DI container created | 78 ms | 84 ms | 84 ms | 94 ms |
| workbench mounted | 101 ms | 106 ms | 108 ms | 119 ms |
| first frame | 101 ms | 106 ms | 108 ms | 119 ms |
| workbench activated | 105 ms | 111 ms | 112 ms | 123 ms |
| grammars preloaded | 110 ms | 116 ms | 117 ms | 130 ms |
| file read from disk | 111 ms | 118 ms | 127 ms | 193 ms |
| file decoded | 111 ms | 118 ms | 127 ms | 193 ms |
| document built | 111 ms | 118 ms | 127 ms | 193 ms |
| tokenizer attached to editor | 127 ms | 137 ms | 148 ms | 217 ms |
| tabs opened | 115 ms | 124 ms | 134 ms | 202 ms |
| built-in extensions registered | 239 ms | 244 ms | 255 ms | 313 ms |
| frame with file text | 127 ms | 134 ms | 146 ms | 215 ms |
| frame with highlighting | 223 ms | 227 ms | 239 ms | 298 ms |
| extension host up | 426 ms | 444 ms | 510 ms | 894 ms |
| startup complete | 235 ms | 240 ms | 251 ms | 310 ms |
| to text (black box) | 129 ms | 138 ms | 148 ms | 217 ms |
| to highlight (black box) | 224 ms | 228 ms | 239 ms | 298 ms |
| gap black − white (text) | 1 ms | 2 ms | 2 ms | 2 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 25 ms | 11 ms | 8 ms | 10 ms | 10 ms | 5 ms | 2 ms |
| `medium` | 25 ms | 12 ms | 10 ms | 8 ms | 13 ms | 5 ms | 3 ms |
| `large` | 35 ms | 18 ms | 18 ms | 14 ms | 46 ms | 12 ms | 15 ms |
| `xlarge` | 26 ms | 24 ms | 12 ms | 16 ms | 116 ms | 14 ms | 63 ms |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
