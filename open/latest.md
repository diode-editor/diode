# File open benchmark

- Recorded: 2026-11-02T10:46:02.141Z, commit `2fd6ca8ebe04`, diode nightly-2fd6ca8
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 22 ms; binary floor (`diode --version` over PTY, median): 55 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **117 ms** | 85 ms | 139 ms | 227 ms | 7 ms | 270 MB | 11 |
| `medium` | 126.7 KB | 2000 | **121 ms** | 88 ms | 143 ms | 237 ms | 9 ms | 281 MB | 11 |
| `large` | 1.3 MB | 20000 | **132 ms** | 99 ms | 154 ms | 256 ms | 4 ms | 295 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **201 ms** | 168 ms | 223 ms | 327 ms | 9 ms | 369 MB | 5 |
| `log500m` | 497 MB | 5295839 | **126 ms** | 93 ms | 148 ms | — (plaintext) | 5 ms | 308 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 6 ms | 7 ms | 5 ms |
| node ready (bootstrapComplete) | 60 ms | 62 ms | 63 ms | 74 ms | 56 ms |
| bundle executed (main:start) | 60 ms | 62 ms | 63 ms | 74 ms | 56 ms |
| config loaded | 75 ms | 78 ms | 79 ms | 86 ms | 75 ms |
| keybindings loaded | 75 ms | 79 ms | 79 ms | 87 ms | 75 ms |
| session state loaded | 75 ms | 79 ms | 80 ms | 87 ms | 75 ms |
| extensions scanned | 72 ms | 74 ms | 75 ms | 84 ms | 72 ms |
| themes ready | 79 ms | 83 ms | 82 ms | 90 ms | 77 ms |
| DI container created | 82 ms | 86 ms | 85 ms | 94 ms | 80 ms |
| workbench mounted | 110 ms | 111 ms | 110 ms | 120 ms | 105 ms |
| first frame | 110 ms | 111 ms | 110 ms | 120 ms | 105 ms |
| workbench activated | 114 ms | 115 ms | 114 ms | 124 ms | 109 ms |
| grammars preloaded | 120 ms | 120 ms | 122 ms | 133 ms | 111 ms |
| file read from disk | 122 ms | 123 ms | 132 ms | 201 ms | 123 ms |
| file decoded | 122 ms | 123 ms | 132 ms | 201 ms | 123 ms |
| document built | 122 ms | 124 ms | 132 ms | 201 ms | 123 ms |
| tokenizer attached to editor | 139 ms | 146 ms | 168 ms | 239 ms | — |
| tabs opened | 125 ms | 128 ms | 140 ms | 209 ms | 138 ms |
| built-in extensions registered | 248 ms | 257 ms | 276 ms | 345 ms | 182 ms |
| frame with file text | 138 ms | 140 ms | 152 ms | 222 ms | 148 ms |
| frame with highlighting | 227 ms | 236 ms | 255 ms | 327 ms | — |
| extension host up | 440 ms | 487 ms | 542 ms | 913 ms | 330 ms |
| startup complete | 243 ms | 252 ms | 271 ms | 340 ms | 176 ms |
| to text (black box) | 139 ms | 143 ms | 154 ms | 223 ms | 148 ms |
| to highlight (black box) | 227 ms | 237 ms | 256 ms | 327 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 1 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 30 ms | 12 ms | 8 ms | 8 ms | 15 ms | 5 ms | 3 ms |
| `medium` | 26 ms | 11 ms | 10 ms | 9 ms | 19 ms | 6 ms | 5 ms |
| `large` | 38 ms | 23 ms | 15 ms | 15 ms | 49 ms | 13 ms | 14 ms |
| `xlarge` | 29 ms | 29 ms | 20 ms | 23 ms | 212 ms | 13 ms | 50 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
