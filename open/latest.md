# File open benchmark

- Recorded: 2026-10-25T10:21:09.091Z, commit `79906a1378ea`, diode nightly-79906a1
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 24 ms; binary floor (`diode --version` over PTY, median): 59 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **134 ms** | 99 ms | 158 ms | 272 ms | 12 ms | 243 MB | 11 |
| `medium` | 126.7 KB | 2000 | **136 ms** | 100 ms | 160 ms | 274 ms | 10 ms | 267 MB | 11 |
| `large` | 1.3 MB | 20000 | **157 ms** | 122 ms | 181 ms | 296 ms | 12 ms | 290 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **246 ms** | 211 ms | 270 ms | 369 ms | 14 ms | 352 MB | 5 |
| `log500m` | 497 MB | 5295839 | **143 ms** | 108 ms | 167 ms | — (plaintext) | 9 ms | 287 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 7 ms | 8 ms | 9 ms | 6 ms |
| node ready (bootstrapComplete) | 64 ms | 65 ms | 73 ms | 80 ms | 59 ms |
| bundle executed (main:start) | 64 ms | 65 ms | 73 ms | 80 ms | 59 ms |
| config loaded | 84 ms | 85 ms | 92 ms | 100 ms | 78 ms |
| keybindings loaded | 84 ms | 86 ms | 93 ms | 100 ms | 79 ms |
| session state loaded | 85 ms | 86 ms | 93 ms | 100 ms | 79 ms |
| extensions scanned | 82 ms | 82 ms | 88 ms | 95 ms | 74 ms |
| themes ready | 87 ms | 89 ms | 96 ms | 103 ms | 81 ms |
| DI container created | 92 ms | 93 ms | 101 ms | 108 ms | 88 ms |
| workbench mounted | 123 ms | 122 ms | 131 ms | 138 ms | 116 ms |
| first frame | 122 ms | 122 ms | 131 ms | 138 ms | 116 ms |
| workbench activated | 128 ms | 127 ms | 136 ms | 143 ms | 121 ms |
| grammars preloaded | 134 ms | 133 ms | 142 ms | 149 ms | 124 ms |
| file read from disk | 136 ms | 137 ms | 154 ms | 247 ms | 136 ms |
| file decoded | 136 ms | 137 ms | 154 ms | 247 ms | 136 ms |
| document built | 137 ms | 137 ms | 155 ms | 247 ms | 136 ms |
| tokenizer attached to editor | 156 ms | 159 ms | 183 ms | 271 ms | — |
| tabs opened | 141 ms | 143 ms | 165 ms | 258 ms | 155 ms |
| built-in extensions registered | 291 ms | 294 ms | 315 ms | 388 ms | 202 ms |
| frame with file text | 156 ms | 157 ms | 181 ms | 270 ms | 167 ms |
| frame with highlighting | 271 ms | 273 ms | 296 ms | 369 ms | — |
| extension host up | 520 ms | 541 ms | 615 ms | 943 ms | 386 ms |
| startup complete | 286 ms | 289 ms | 309 ms | 384 ms | 196 ms |
| to text (black box) | 158 ms | 160 ms | 181 ms | 270 ms | 167 ms |
| to highlight (black box) | 272 ms | 274 ms | 296 ms | 369 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 36 ms | 8 ms | 9 ms | 9 ms | 16 ms | 8 ms | 3 ms |
| `medium` | 31 ms | 13 ms | 13 ms | 9 ms | 14 ms | 6 ms | 7 ms |
| `large` | 33 ms | 21 ms | 21 ms | 16 ms | 41 ms | 12 ms | 17 ms |
| `xlarge` | 29 ms | 21 ms | 10 ms | 10 ms | 103 ms | 10 ms | 89 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
