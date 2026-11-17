# File open benchmark

- Recorded: 2026-11-17T05:42:42.824Z, commit `f1cb56e64297`, diode nightly-f1cb56e
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 19 ms; binary floor (`diode --version` over PTY, median): 59 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **128 ms** | 88 ms | 147 ms | 238 ms | 10 ms | 283 MB | 11 |
| `medium` | 126.7 KB | 2000 | **134 ms** | 94 ms | 153 ms | 241 ms | 2 ms | 293 MB | 11 |
| `large` | 1.3 MB | 20000 | **150 ms** | 110 ms | 169 ms | 255 ms | 8 ms | 305 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **225 ms** | 185 ms | 245 ms | 323 ms | 2 ms | 359 MB | 5 |
| `log500m` | 497 MB | 5295839 | **143 ms** | 103 ms | 162 ms | — (plaintext) | 3 ms | 284 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 9 ms | 9 ms | 5 ms |
| node ready (bootstrapComplete) | 64 ms | 65 ms | 76 ms | 81 ms | 60 ms |
| bundle executed (main:start) | 64 ms | 65 ms | 76 ms | 81 ms | 60 ms |
| config loaded | 82 ms | 83 ms | 93 ms | 101 ms | 74 ms |
| keybindings loaded | 82 ms | 84 ms | 94 ms | 101 ms | 75 ms |
| session state loaded | 82 ms | 85 ms | 94 ms | 101 ms | 75 ms |
| extensions scanned | 76 ms | 77 ms | 89 ms | 96 ms | 71 ms |
| themes ready | 85 ms | 88 ms | 97 ms | 106 ms | 79 ms |
| DI container created | 88 ms | 90 ms | 100 ms | 109 ms | 83 ms |
| workbench mounted | 117 ms | 120 ms | 129 ms | 145 ms | 117 ms |
| first frame | 117 ms | 120 ms | 129 ms | 145 ms | 117 ms |
| workbench activated | 123 ms | 127 ms | 135 ms | 151 ms | 123 ms |
| grammars preloaded | 126 ms | 131 ms | 138 ms | 155 ms | 128 ms |
| file read from disk | 128 ms | 134 ms | 147 ms | 220 ms | 136 ms |
| file decoded | 128 ms | 134 ms | 147 ms | 220 ms | 136 ms |
| document built | 129 ms | 134 ms | 147 ms | 220 ms | 136 ms |
| tokenizer attached to editor | 146 ms | 154 ms | 170 ms | 244 ms | — |
| tabs opened | 132 ms | 139 ms | 155 ms | 230 ms | 151 ms |
| built-in extensions registered | 261 ms | 266 ms | 279 ms | 345 ms | 199 ms |
| frame with file text | 145 ms | 152 ms | 168 ms | 242 ms | 162 ms |
| frame with highlighting | 238 ms | 241 ms | 255 ms | 323 ms | — |
| extension host up | 453 ms | 493 ms | 562 ms | 940 ms | 358 ms |
| startup complete | 253 ms | 258 ms | 270 ms | 338 ms | 191 ms |
| to text (black box) | 147 ms | 153 ms | 169 ms | 245 ms | 162 ms |
| to highlight (black box) | 238 ms | 241 ms | 255 ms | 323 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 1 ms | 2 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 31 ms | 14 ms | 9 ms | 7 ms | — | 5 ms | 3 ms |
| `medium` failed | 28 ms | 13 ms | 9 ms | 8 ms | — | 7 ms | 4 ms |
| `large` failed | 30 ms | 27 ms | 19 ms | 19 ms | — | 16 ms | 15 ms |
| `xlarge` failed | 35 ms | 34 ms | 23 ms | 30 ms | — | 12 ms | 60 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
