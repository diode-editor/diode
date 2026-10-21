# File open benchmark

- Recorded: 2026-10-21T19:47:50.340Z, commit `f1a9b9b5bcff`, diode nightly-f1a9b9b
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 27 ms; binary floor (`diode --version` over PTY, median): 62 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **132 ms** | 97 ms | 159 ms | 285 ms | 21 ms | 245 MB | 11 |
| `medium` | 126.7 KB | 2000 | **161 ms** | 126 ms | 188 ms | 302 ms | 6 ms | 270 MB | 11 |
| `large` | 1.3 MB | 20000 | **307 ms** | 272 ms | 334 ms | 439 ms | 14 ms | 300 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **1554 ms** | 1519 ms | 1581 ms | 1750 ms | 4 ms | 499 MB | 5 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` |
| --- | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 8 ms | 16 ms |
| node ready (bootstrapComplete) | 68 ms | 68 ms | 71 ms | 96 ms |
| bundle executed (main:start) | 68 ms | 68 ms | 71 ms | 97 ms |
| config loaded | 87 ms | 86 ms | 88 ms | 116 ms |
| keybindings loaded | 88 ms | 88 ms | 90 ms | 117 ms |
| session state loaded | 88 ms | 88 ms | 90 ms | 117 ms |
| extensions scanned | 84 ms | 83 ms | 84 ms | 113 ms |
| themes ready | 91 ms | 91 ms | 93 ms | 122 ms |
| DI container created | 95 ms | 95 ms | 96 ms | 126 ms |
| workbench mounted | 121 ms | 121 ms | 122 ms | 155 ms |
| first frame | 121 ms | 121 ms | 122 ms | 155 ms |
| workbench activated | 126 ms | 126 ms | 127 ms | 160 ms |
| grammars preloaded | 136 ms | 131 ms | 134 ms | 165 ms |
| file read from disk | 137 ms | 134 ms | 147 ms | 251 ms |
| file decoded | 137 ms | 134 ms | 147 ms | 251 ms |
| document built | 137 ms | 134 ms | 147 ms | 251 ms |
| tokenizer attached to editor | 158 ms | 187 ms | 335 ms | 1583 ms |
| tabs opened | 142 ms | 143 ms | 167 ms | 292 ms |
| built-in extensions registered | 312 ms | 322 ms | 457 ms | 1768 ms |
| frame with file text | 158 ms | 186 ms | 332 ms | 1581 ms |
| frame with highlighting | 284 ms | 300 ms | 439 ms | 1750 ms |
| extension host up | 556 ms | 563 ms | 735 ms | 2314 ms |
| startup complete | 305 ms | 316 ms | 453 ms | 1764 ms |
| to text (black box) | 159 ms | 188 ms | 334 ms | 1581 ms |
| to highlight (black box) | 285 ms | 302 ms | 439 ms | 1750 ms |
| gap black − white (text) | 3 ms | 2 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 46 ms | 14 ms | 12 ms | 12 ms | 18 ms | 9 ms | 5 ms |
| `medium` | 46 ms | 18 ms | 13 ms | 12 ms | 14 ms | 7 ms | 9 ms |
| `large` | 69 ms | 67 ms | 50 ms | 54 ms | 59 ms | 15 ms | 14 ms |
| `xlarge` | 258 ms | 429 ms | 418 ms | 311 ms | 254 ms | 10 ms | 57 ms |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
