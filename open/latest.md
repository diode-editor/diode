# File open benchmark

- Recorded: 2026-10-25T18:21:36.915Z, commit `5a5c1cc4a01c`, diode nightly-5a5c1cc
- Machine: Intel(R) Xeon(R) Platinum 8370C CPU @ 2.80GHz (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 24 ms; binary floor (`diode --version` over PTY, median): 59 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **135 ms** | 100 ms | 159 ms | 281 ms | 8 ms | 245 MB | 11 |
| `medium` | 126.7 KB | 2000 | **136 ms** | 100 ms | 160 ms | 275 ms | 4 ms | 247 MB | 11 |
| `large` | 1.3 MB | 20000 | **149 ms** | 114 ms | 173 ms | 295 ms | 6 ms | 286 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **231 ms** | 196 ms | 255 ms | 357 ms | 18 ms | 350 MB | 5 |
| `log500m` | 497 MB | 5295839 | **150 ms** | 115 ms | 174 ms | — (plaintext) | 6 ms | 263 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 6 ms | 7 ms | 7 ms | 5 ms |
| node ready (bootstrapComplete) | 64 ms | 62 ms | 64 ms | 73 ms | 60 ms |
| bundle executed (main:start) | 64 ms | 62 ms | 65 ms | 73 ms | 60 ms |
| config loaded | 81 ms | 77 ms | 88 ms | 90 ms | 78 ms |
| keybindings loaded | 83 ms | 78 ms | 88 ms | 90 ms | 79 ms |
| session state loaded | 83 ms | 78 ms | 88 ms | 90 ms | 79 ms |
| extensions scanned | 77 ms | 75 ms | 81 ms | 86 ms | 75 ms |
| themes ready | 88 ms | 83 ms | 91 ms | 94 ms | 84 ms |
| DI container created | 92 ms | 87 ms | 94 ms | 99 ms | 88 ms |
| workbench mounted | 122 ms | 117 ms | 122 ms | 130 ms | 116 ms |
| first frame | 122 ms | 117 ms | 122 ms | 130 ms | 116 ms |
| workbench activated | 127 ms | 123 ms | 127 ms | 136 ms | 120 ms |
| grammars preloaded | 136 ms | 134 ms | 136 ms | 148 ms | 126 ms |
| file read from disk | 138 ms | 138 ms | 149 ms | 232 ms | 139 ms |
| file decoded | 138 ms | 138 ms | 149 ms | 232 ms | 139 ms |
| document built | 139 ms | 138 ms | 150 ms | 232 ms | 139 ms |
| tokenizer attached to editor | 159 ms | 160 ms | 175 ms | 256 ms | — |
| tabs opened | 143 ms | 144 ms | 158 ms | 241 ms | 159 ms |
| built-in extensions registered | 297 ms | 294 ms | 311 ms | 373 ms | 211 ms |
| frame with file text | 158 ms | 159 ms | 173 ms | 254 ms | 174 ms |
| frame with highlighting | 280 ms | 275 ms | 295 ms | 357 ms | — |
| extension host up | 519 ms | 529 ms | 598 ms | 909 ms | 384 ms |
| startup complete | 292 ms | 290 ms | 306 ms | 369 ms | 206 ms |
| to text (black box) | 159 ms | 160 ms | 173 ms | 255 ms | 174 ms |
| to highlight (black box) | 281 ms | 275 ms | 295 ms | 357 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 0 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 35 ms | 11 ms | 10 ms | 11 ms | 17 ms | 8 ms | 3 ms |
| `medium` | 34 ms | 11 ms | 13 ms | 10 ms | 20 ms | 7 ms | 4 ms |
| `large` | 31 ms | 17 ms | 15 ms | 17 ms | 53 ms | 16 ms | 15 ms |
| `xlarge` | 29 ms | 20 ms | 12 ms | 13 ms | 103 ms | 9 ms | 91 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
