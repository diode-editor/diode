# File open benchmark

- Recorded: 2026-10-29T23:47:28.393Z, commit `7701b7f1734b`, diode nightly-7701b7f
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 23 ms; binary floor (`diode --version` over PTY, median): 60 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **142 ms** | 105 ms | 165 ms | 281 ms | 6 ms | 254 MB | 11 |
| `medium` | 126.7 KB | 2000 | **142 ms** | 105 ms | 165 ms | 281 ms | 6 ms | 277 MB | 11 |
| `large` | 1.3 MB | 20000 | **161 ms** | 124 ms | 185 ms | 316 ms | 10 ms | 297 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **240 ms** | 202 ms | 263 ms | 393 ms | 2 ms | 361 MB | 5 |
| `log500m` | 497 MB | 5295839 | **154 ms** | 117 ms | 177 ms | — (plaintext) | 2 ms | 302 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 6 ms | 7 ms | 10 ms | 5 ms |
| node ready (bootstrapComplete) | 65 ms | 65 ms | 67 ms | 76 ms | 63 ms |
| bundle executed (main:start) | 65 ms | 65 ms | 67 ms | 77 ms | 63 ms |
| config loaded | 83 ms | 83 ms | 87 ms | 93 ms | 81 ms |
| keybindings loaded | 83 ms | 83 ms | 88 ms | 94 ms | 84 ms |
| session state loaded | 83 ms | 83 ms | 88 ms | 94 ms | 84 ms |
| extensions scanned | 80 ms | 80 ms | 83 ms | 88 ms | 78 ms |
| themes ready | 88 ms | 87 ms | 91 ms | 97 ms | 86 ms |
| DI container created | 93 ms | 91 ms | 94 ms | 101 ms | 90 ms |
| workbench mounted | 125 ms | 124 ms | 125 ms | 137 ms | 122 ms |
| first frame | 125 ms | 124 ms | 125 ms | 136 ms | 122 ms |
| workbench activated | 131 ms | 129 ms | 131 ms | 141 ms | 127 ms |
| grammars preloaded | 141 ms | 136 ms | 140 ms | 151 ms | 129 ms |
| file read from disk | 143 ms | 140 ms | 157 ms | 236 ms | 142 ms |
| file decoded | 143 ms | 140 ms | 157 ms | 236 ms | 142 ms |
| document built | 144 ms | 141 ms | 158 ms | 237 ms | 142 ms |
| tokenizer attached to editor | 164 ms | 170 ms | 199 ms | 278 ms | — |
| tabs opened | 147 ms | 147 ms | 166 ms | 247 ms | 161 ms |
| built-in extensions registered | 308 ms | 307 ms | 339 ms | 416 ms | 217 ms |
| frame with file text | 162 ms | 161 ms | 182 ms | 261 ms | 177 ms |
| frame with highlighting | 280 ms | 280 ms | 316 ms | 393 ms | — |
| extension host up | 537 ms | 582 ms | 645 ms | 1073 ms | 398 ms |
| startup complete | 302 ms | 301 ms | 334 ms | 410 ms | 210 ms |
| to text (black box) | 165 ms | 165 ms | 185 ms | 263 ms | 177 ms |
| to highlight (black box) | 281 ms | 281 ms | 316 ms | 393 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 3 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 33 ms | 12 ms | 10 ms | 9 ms | 18 ms | 7 ms | 3 ms |
| `medium` | 37 ms | 11 ms | 12 ms | 8 ms | 18 ms | 6 ms | 4 ms |
| `large` | 42 ms | 20 ms | 22 ms | 17 ms | 40 ms | 16 ms | 15 ms |
| `xlarge` | 25 ms | 17 ms | 9 ms | 14 ms | 111 ms | 8 ms | 69 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
