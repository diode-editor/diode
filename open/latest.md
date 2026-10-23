# File open benchmark

- Recorded: 2026-10-23T21:50:17.354Z, commit `3a488b279253`, diode nightly-3a488b2
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 24 ms; binary floor (`diode --version` over PTY, median): 58 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **131 ms** | 97 ms | 155 ms | 266 ms | 9 ms | 244 MB | 11 |
| `medium` | 126.7 KB | 2000 | **136 ms** | 102 ms | 160 ms | 270 ms | 13 ms | 262 MB | 11 |
| `large` | 1.3 MB | 20000 | **148 ms** | 114 ms | 172 ms | 286 ms | 4 ms | 284 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **250 ms** | 216 ms | 273 ms | 376 ms | 6 ms | 461 MB | 5 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` |
| --- | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 6 ms | 8 ms | 8 ms |
| node ready (bootstrapComplete) | 62 ms | 64 ms | 68 ms | 77 ms |
| bundle executed (main:start) | 62 ms | 64 ms | 68 ms | 77 ms |
| config loaded | 82 ms | 81 ms | 88 ms | 91 ms |
| keybindings loaded | 84 ms | 83 ms | 91 ms | 92 ms |
| session state loaded | 84 ms | 83 ms | 91 ms | 92 ms |
| extensions scanned | 78 ms | 78 ms | 85 ms | 88 ms |
| themes ready | 87 ms | 86 ms | 94 ms | 96 ms |
| DI container created | 91 ms | 91 ms | 97 ms | 101 ms |
| workbench mounted | 118 ms | 120 ms | 124 ms | 133 ms |
| first frame | 118 ms | 120 ms | 124 ms | 133 ms |
| workbench activated | 123 ms | 125 ms | 129 ms | 138 ms |
| grammars preloaded | 131 ms | 135 ms | 135 ms | 149 ms |
| file read from disk | 133 ms | 138 ms | 146 ms | 246 ms |
| file decoded | 133 ms | 138 ms | 146 ms | 246 ms |
| document built | 133 ms | 138 ms | 146 ms | 246 ms |
| tokenizer attached to editor | 153 ms | 161 ms | 171 ms | 272 ms |
| tabs opened | 138 ms | 144 ms | 154 ms | 256 ms |
| built-in extensions registered | 290 ms | 292 ms | 305 ms | 394 ms |
| frame with file text | 152 ms | 158 ms | 169 ms | 271 ms |
| frame with highlighting | 266 ms | 269 ms | 285 ms | 376 ms |
| extension host up | 511 ms | 547 ms | 608 ms | 1077 ms |
| startup complete | 283 ms | 287 ms | 300 ms | 390 ms |
| to text (black box) | 155 ms | 160 ms | 172 ms | 273 ms |
| to highlight (black box) | 266 ms | 270 ms | 286 ms | 376 ms |
| gap black − white (text) | 1 ms | 2 ms | 1 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 41 ms | 12 ms | 10 ms | 12 ms | 14 ms | 7 ms | 3 ms |
| `medium` | 31 ms | 11 ms | 9 ms | 9 ms | 15 ms | 6 ms | 8 ms |
| `large` | 38 ms | 15 ms | 16 ms | 14 ms | 36 ms | 16 ms | 16 ms |
| `xlarge` | 54 ms | 26 ms | 15 ms | 18 ms | 111 ms | 15 ms | 74 ms |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
