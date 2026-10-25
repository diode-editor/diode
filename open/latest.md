# File open benchmark

- Recorded: 2026-10-25T10:08:39.294Z, commit `d8d410e9c2be`, diode nightly-d8d410e
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 20 ms; binary floor (`diode --version` over PTY, median): 51 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **103 ms** | 72 ms | 123 ms | 214 ms | 9 ms | 244 MB | 11 |
| `medium` | 126.7 KB | 2000 | **105 ms** | 75 ms | 125 ms | 212 ms | 4 ms | 264 MB | 11 |
| `large` | 1.3 MB | 20000 | **115 ms** | 85 ms | 136 ms | 224 ms | 6 ms | 289 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **197 ms** | 166 ms | 217 ms | 294 ms | 15 ms | 359 MB | 5 |
| `log500m` | 497 MB | 5295839 | **113 ms** | 82 ms | 133 ms | — (plaintext) | 3 ms | 299 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 5 ms | 5 ms | 9 ms | 5 ms |
| node ready (bootstrapComplete) | 54 ms | 54 ms | 54 ms | 72 ms | 50 ms |
| bundle executed (main:start) | 54 ms | 54 ms | 54 ms | 72 ms | 50 ms |
| config loaded | 68 ms | 71 ms | 70 ms | 88 ms | 66 ms |
| keybindings loaded | 68 ms | 71 ms | 71 ms | 88 ms | 66 ms |
| session state loaded | 68 ms | 71 ms | 71 ms | 88 ms | 66 ms |
| extensions scanned | 66 ms | 66 ms | 67 ms | 86 ms | 64 ms |
| themes ready | 70 ms | 74 ms | 73 ms | 91 ms | 69 ms |
| DI container created | 75 ms | 76 ms | 75 ms | 95 ms | 71 ms |
| workbench mounted | 98 ms | 98 ms | 96 ms | 114 ms | 91 ms |
| first frame | 98 ms | 98 ms | 96 ms | 114 ms | 91 ms |
| workbench activated | 102 ms | 101 ms | 100 ms | 118 ms | 94 ms |
| grammars preloaded | 107 ms | 106 ms | 106 ms | 125 ms | 99 ms |
| file read from disk | 109 ms | 109 ms | 116 ms | 198 ms | 107 ms |
| file decoded | 109 ms | 109 ms | 116 ms | 198 ms | 107 ms |
| document built | 109 ms | 109 ms | 116 ms | 198 ms | 107 ms |
| tokenizer attached to editor | 124 ms | 126 ms | 135 ms | 218 ms | — |
| tabs opened | 112 ms | 113 ms | 124 ms | 205 ms | 120 ms |
| built-in extensions registered | 228 ms | 228 ms | 240 ms | 309 ms | 157 ms |
| frame with file text | 123 ms | 124 ms | 134 ms | 217 ms | 130 ms |
| frame with highlighting | 214 ms | 211 ms | 224 ms | 293 ms | — |
| extension host up | 399 ms | 412 ms | 469 ms | 757 ms | 283 ms |
| startup complete | 225 ms | 224 ms | 236 ms | 305 ms | 154 ms |
| to text (black box) | 123 ms | 125 ms | 136 ms | 217 ms | 133 ms |
| to highlight (black box) | 214 ms | 212 ms | 224 ms | 294 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 2 ms | 0 ms | 2 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 29 ms | 7 ms | 6 ms | 8 ms | 10 ms | 6 ms | 2 ms |
| `medium` | 26 ms | 10 ms | 6 ms | 7 ms | 14 ms | 6 ms | 3 ms |
| `large` | 32 ms | 18 ms | 14 ms | 13 ms | 38 ms | 9 ms | 11 ms |
| `xlarge` | 21 ms | 20 ms | 11 ms | 17 ms | 120 ms | 11 ms | 59 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
