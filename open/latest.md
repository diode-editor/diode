# File open benchmark

- Recorded: 2026-11-08T23:08:33.691Z, commit `08b8d682617f`, diode nightly-08b8d68
- Machine: INTEL(R) XEON(R) PLATINUM 8573C (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 26 ms; binary floor (`diode --version` over PTY, median): 63 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **147 ms** | 110 ms | 173 ms | 288 ms | 10 ms | 262 MB | 11 |
| `medium` | 126.7 KB | 2000 | **148 ms** | 111 ms | 174 ms | 284 ms | 4 ms | 289 MB | 11 |
| `large` | 1.3 MB | 20000 | **160 ms** | 122 ms | 185 ms | 298 ms | 7 ms | 299 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **245 ms** | 207 ms | 271 ms | 363 ms | 16 ms | 351 MB | 5 |
| `log500m` | 497 MB | 5295839 | **157 ms** | 119 ms | 182 ms | — (plaintext) | 6 ms | 311 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 6 ms | 7 ms | 5 ms |
| node ready (bootstrapComplete) | 66 ms | 67 ms | 68 ms | 75 ms | 64 ms |
| bundle executed (main:start) | 66 ms | 67 ms | 68 ms | 75 ms | 64 ms |
| config loaded | 85 ms | 84 ms | 85 ms | 91 ms | 83 ms |
| keybindings loaded | 85 ms | 84 ms | 86 ms | 91 ms | 84 ms |
| session state loaded | 85 ms | 84 ms | 86 ms | 92 ms | 84 ms |
| extensions scanned | 81 ms | 80 ms | 82 ms | 88 ms | 78 ms |
| themes ready | 90 ms | 89 ms | 91 ms | 96 ms | 88 ms |
| DI container created | 94 ms | 93 ms | 95 ms | 100 ms | 91 ms |
| workbench mounted | 132 ms | 129 ms | 131 ms | 138 ms | 124 ms |
| first frame | 132 ms | 129 ms | 131 ms | 138 ms | 124 ms |
| workbench activated | 145 ms | 142 ms | 144 ms | 151 ms | 130 ms |
| grammars preloaded | 150 ms | 147 ms | 148 ms | 155 ms | 133 ms |
| file read from disk | 153 ms | 151 ms | 162 ms | 248 ms | 145 ms |
| file decoded | 153 ms | 151 ms | 162 ms | 248 ms | 145 ms |
| document built | 153 ms | 151 ms | 162 ms | 248 ms | 145 ms |
| tokenizer attached to editor | 171 ms | 174 ms | 185 ms | 272 ms | — |
| tabs opened | 157 ms | 157 ms | 171 ms | 257 ms | 164 ms |
| built-in extensions registered | 307 ms | 305 ms | 319 ms | 383 ms | 217 ms |
| frame with file text | 170 ms | 171 ms | 183 ms | 270 ms | 182 ms |
| frame with highlighting | 285 ms | 284 ms | 297 ms | 363 ms | — |
| extension host up | 543 ms | 560 ms | 621 ms | 1068 ms | 415 ms |
| startup complete | 299 ms | 297 ms | 310 ms | 375 ms | 207 ms |
| to text (black box) | 173 ms | 174 ms | 185 ms | 271 ms | 182 ms |
| to highlight (black box) | 288 ms | 284 ms | 298 ms | 363 ms | — |
| gap black − white (text) | 2 ms | 3 ms | 2 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 30 ms | 13 ms | 11 ms | 9 ms | — | 7 ms | 4 ms |
| `medium` failed | 27 ms | 16 ms | 10 ms | 10 ms | — | 6 ms | 6 ms |
| `large` failed | 33 ms | 19 ms | 22 ms | 16 ms | — | 17 ms | 25 ms |
| `xlarge` failed | 36 ms | 41 ms | 24 ms | 63 ms | — | 29 ms | 81 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
