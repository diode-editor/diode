# File open benchmark

- Recorded: 2026-11-01T00:50:37.471Z, commit `321b3131690a`, diode nightly-321b313
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 22 ms; binary floor (`diode --version` over PTY, median): 55 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **115 ms** | 81 ms | 136 ms | 227 ms | 3 ms | 266 MB | 11 |
| `medium` | 126.7 KB | 2000 | **121 ms** | 88 ms | 143 ms | 233 ms | 6 ms | 282 MB | 11 |
| `large` | 1.3 MB | 20000 | **133 ms** | 100 ms | 155 ms | 258 ms | 11 ms | 300 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **193 ms** | 160 ms | 215 ms | 320 ms | 10 ms | 368 MB | 5 |
| `log500m` | 497 MB | 5295839 | **123 ms** | 89 ms | 144 ms | — (plaintext) | 6 ms | 270 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 6 ms | 6 ms | 9 ms | 5 ms |
| node ready (bootstrapComplete) | 60 ms | 59 ms | 58 ms | 73 ms | 53 ms |
| bundle executed (main:start) | 60 ms | 59 ms | 58 ms | 73 ms | 53 ms |
| config loaded | 77 ms | 74 ms | 76 ms | 91 ms | 68 ms |
| keybindings loaded | 78 ms | 74 ms | 76 ms | 91 ms | 68 ms |
| session state loaded | 78 ms | 74 ms | 76 ms | 91 ms | 68 ms |
| extensions scanned | 72 ms | 70 ms | 72 ms | 87 ms | 65 ms |
| themes ready | 80 ms | 78 ms | 81 ms | 95 ms | 72 ms |
| DI container created | 83 ms | 82 ms | 85 ms | 98 ms | 75 ms |
| workbench mounted | 107 ms | 108 ms | 111 ms | 121 ms | 102 ms |
| first frame | 107 ms | 108 ms | 111 ms | 121 ms | 102 ms |
| workbench activated | 111 ms | 112 ms | 115 ms | 125 ms | 106 ms |
| grammars preloaded | 117 ms | 120 ms | 121 ms | 129 ms | 111 ms |
| file read from disk | 119 ms | 123 ms | 134 ms | 194 ms | 120 ms |
| file decoded | 119 ms | 123 ms | 134 ms | 194 ms | 120 ms |
| document built | 119 ms | 123 ms | 134 ms | 195 ms | 120 ms |
| tokenizer attached to editor | 136 ms | 146 ms | 169 ms | 232 ms | — |
| tabs opened | 123 ms | 129 ms | 141 ms | 203 ms | 134 ms |
| built-in extensions registered | 249 ms | 253 ms | 277 ms | 339 ms | 177 ms |
| frame with file text | 134 ms | 141 ms | 152 ms | 215 ms | 144 ms |
| frame with highlighting | 227 ms | 231 ms | 258 ms | 320 ms | — |
| extension host up | 444 ms | 464 ms | 528 ms | 891 ms | 327 ms |
| startup complete | 244 ms | 248 ms | 271 ms | 333 ms | 172 ms |
| to text (black box) | 136 ms | 143 ms | 155 ms | 215 ms | 144 ms |
| to highlight (black box) | 227 ms | 233 ms | 258 ms | 320 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 1 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 32 ms | 10 ms | 7 ms | 8 ms | 11 ms | 5 ms | 4 ms |
| `medium` | 26 ms | 11 ms | 11 ms | 8 ms | 13 ms | 7 ms | 4 ms |
| `large` | 36 ms | 16 ms | 14 ms | 11 ms | 34 ms | 10 ms | 12 ms |
| `xlarge` | 27 ms | 27 ms | 16 ms | 19 ms | 159 ms | 18 ms | 60 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
