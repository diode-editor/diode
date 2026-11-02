# File open benchmark

- Recorded: 2026-11-02T07:57:32.413Z, commit `c12db068971c`, diode nightly-c12db06
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 21 ms; binary floor (`diode --version` over PTY, median): 54 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **115 ms** | 82 ms | 136 ms | 223 ms | 7 ms | 270 MB | 11 |
| `medium` | 126.7 KB | 2000 | **123 ms** | 90 ms | 144 ms | 237 ms | 5 ms | 280 MB | 11 |
| `large` | 1.3 MB | 20000 | **131 ms** | 99 ms | 152 ms | 252 ms | 3 ms | 297 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **201 ms** | 169 ms | 222 ms | 326 ms | 18 ms | 368 MB | 5 |
| `log500m` | 497 MB | 5295839 | **122 ms** | 89 ms | 142 ms | — (plaintext) | 4 ms | 314 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 6 ms | 7 ms | 5 ms |
| node ready (bootstrapComplete) | 60 ms | 60 ms | 58 ms | 74 ms | 54 ms |
| bundle executed (main:start) | 60 ms | 60 ms | 58 ms | 74 ms | 54 ms |
| config loaded | 75 ms | 75 ms | 77 ms | 88 ms | 71 ms |
| keybindings loaded | 78 ms | 76 ms | 77 ms | 88 ms | 71 ms |
| session state loaded | 78 ms | 76 ms | 77 ms | 88 ms | 71 ms |
| extensions scanned | 73 ms | 72 ms | 73 ms | 86 ms | 69 ms |
| themes ready | 81 ms | 80 ms | 80 ms | 92 ms | 74 ms |
| DI container created | 83 ms | 84 ms | 84 ms | 95 ms | 77 ms |
| workbench mounted | 107 ms | 108 ms | 108 ms | 122 ms | 104 ms |
| first frame | 107 ms | 108 ms | 108 ms | 122 ms | 104 ms |
| workbench activated | 111 ms | 112 ms | 112 ms | 126 ms | 107 ms |
| grammars preloaded | 117 ms | 121 ms | 119 ms | 136 ms | 109 ms |
| file read from disk | 119 ms | 124 ms | 132 ms | 202 ms | 118 ms |
| file decoded | 119 ms | 124 ms | 132 ms | 202 ms | 118 ms |
| document built | 120 ms | 124 ms | 132 ms | 203 ms | 118 ms |
| tokenizer attached to editor | 136 ms | 146 ms | 167 ms | 240 ms | — |
| tabs opened | 123 ms | 128 ms | 139 ms | 211 ms | 132 ms |
| built-in extensions registered | 244 ms | 257 ms | 271 ms | 344 ms | 174 ms |
| frame with file text | 135 ms | 141 ms | 150 ms | 222 ms | 142 ms |
| frame with highlighting | 223 ms | 237 ms | 252 ms | 326 ms | — |
| extension host up | 429 ms | 475 ms | 525 ms | 903 ms | 318 ms |
| startup complete | 239 ms | 253 ms | 266 ms | 339 ms | 169 ms |
| to text (black box) | 136 ms | 144 ms | 152 ms | 222 ms | 142 ms |
| to highlight (black box) | 223 ms | 237 ms | 252 ms | 326 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 2 ms | 0 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 27 ms | 9 ms | 8 ms | 8 ms | 17 ms | 8 ms | 3 ms |
| `medium` | 30 ms | 13 ms | 8 ms | 7 ms | 15 ms | 7 ms | 4 ms |
| `large` | 38 ms | 18 ms | 15 ms | 12 ms | 43 ms | 12 ms | 16 ms |
| `xlarge` | 42 ms | 26 ms | 17 ms | 21 ms | 166 ms | 12 ms | 57 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
