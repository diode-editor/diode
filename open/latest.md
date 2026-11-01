# File open benchmark

- Recorded: 2026-11-01T21:26:36.636Z, commit `3d0f683f6c53`, diode nightly-3d0f683
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 21 ms; binary floor (`diode --version` over PTY, median): 54 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **116 ms** | 82 ms | 136 ms | 226 ms | 8 ms | 273 MB | 11 |
| `medium` | 126.7 KB | 2000 | **120 ms** | 86 ms | 140 ms | 233 ms | 6 ms | 281 MB | 11 |
| `large` | 1.3 MB | 20000 | **125 ms** | 91 ms | 145 ms | 246 ms | 4 ms | 297 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **205 ms** | 171 ms | 226 ms | 325 ms | 18 ms | 369 MB | 5 |
| `log500m` | 497 MB | 5295839 | **120 ms** | 87 ms | 141 ms | — (plaintext) | 6 ms | 308 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 6 ms | 8 ms | 5 ms |
| node ready (bootstrapComplete) | 59 ms | 60 ms | 59 ms | 81 ms | 54 ms |
| bundle executed (main:start) | 59 ms | 60 ms | 59 ms | 81 ms | 54 ms |
| config loaded | 75 ms | 76 ms | 73 ms | 94 ms | 68 ms |
| keybindings loaded | 76 ms | 78 ms | 76 ms | 94 ms | 69 ms |
| session state loaded | 76 ms | 78 ms | 76 ms | 94 ms | 69 ms |
| extensions scanned | 73 ms | 73 ms | 71 ms | 91 ms | 65 ms |
| themes ready | 80 ms | 80 ms | 79 ms | 98 ms | 74 ms |
| DI container created | 83 ms | 83 ms | 81 ms | 101 ms | 77 ms |
| workbench mounted | 107 ms | 106 ms | 106 ms | 128 ms | 99 ms |
| first frame | 107 ms | 106 ms | 106 ms | 128 ms | 99 ms |
| workbench activated | 111 ms | 110 ms | 109 ms | 132 ms | 103 ms |
| grammars preloaded | 117 ms | 117 ms | 115 ms | 142 ms | 105 ms |
| file read from disk | 119 ms | 120 ms | 125 ms | 203 ms | 116 ms |
| file decoded | 119 ms | 121 ms | 125 ms | 203 ms | 116 ms |
| document built | 119 ms | 121 ms | 126 ms | 203 ms | 116 ms |
| tokenizer attached to editor | 136 ms | 143 ms | 160 ms | 239 ms | — |
| tabs opened | 124 ms | 126 ms | 132 ms | 211 ms | 130 ms |
| built-in extensions registered | 246 ms | 253 ms | 265 ms | 342 ms | 172 ms |
| frame with file text | 134 ms | 137 ms | 143 ms | 223 ms | 141 ms |
| frame with highlighting | 226 ms | 233 ms | 246 ms | 324 ms | — |
| extension host up | 436 ms | 487 ms | 525 ms | 889 ms | 329 ms |
| startup complete | 241 ms | 248 ms | 260 ms | 338 ms | 166 ms |
| to text (black box) | 136 ms | 140 ms | 145 ms | 226 ms | 141 ms |
| to highlight (black box) | 226 ms | 233 ms | 246 ms | 325 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 2 ms | 2 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 27 ms | 9 ms | 8 ms | 8 ms | 22 ms | 6 ms | 3 ms |
| `medium` | 27 ms | 14 ms | 11 ms | 8 ms | 15 ms | 5 ms | 4 ms |
| `large` | 33 ms | 20 ms | 17 ms | 16 ms | 39 ms | 9 ms | 14 ms |
| `xlarge` | 32 ms | 30 ms | 23 ms | 26 ms | 203 ms | 14 ms | 53 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
