# File open benchmark

- Recorded: 2026-10-29T22:15:19.187Z, commit `5c2c58335a70`, diode nightly-5c2c583
- Machine: INTEL(R) XEON(R) PLATINUM 8573C (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 62 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **129 ms** | 92 ms | 154 ms | 272 ms | 5 ms | 253 MB | 11 |
| `medium` | 126.7 KB | 2000 | **131 ms** | 94 ms | 156 ms | 275 ms | 5 ms | 280 MB | 11 |
| `large` | 1.3 MB | 20000 | **144 ms** | 107 ms | 169 ms | 303 ms | 5 ms | 299 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **232 ms** | 194 ms | 256 ms | 383 ms | 7 ms | 363 MB | 5 |
| `log500m` | 497 MB | 5295839 | **143 ms** | 105 ms | 167 ms | — (plaintext) | 2 ms | 271 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 6 ms | 7 ms | 5 ms |
| node ready (bootstrapComplete) | 63 ms | 62 ms | 63 ms | 69 ms | 61 ms |
| bundle executed (main:start) | 63 ms | 62 ms | 63 ms | 69 ms | 61 ms |
| config loaded | 80 ms | 79 ms | 78 ms | 84 ms | 75 ms |
| keybindings loaded | 81 ms | 79 ms | 78 ms | 84 ms | 75 ms |
| session state loaded | 81 ms | 79 ms | 78 ms | 84 ms | 75 ms |
| extensions scanned | 76 ms | 76 ms | 75 ms | 81 ms | 72 ms |
| themes ready | 86 ms | 83 ms | 82 ms | 89 ms | 81 ms |
| DI container created | 90 ms | 87 ms | 86 ms | 93 ms | 84 ms |
| workbench mounted | 119 ms | 117 ms | 117 ms | 125 ms | 116 ms |
| first frame | 119 ms | 117 ms | 117 ms | 124 ms | 116 ms |
| workbench activated | 123 ms | 122 ms | 121 ms | 129 ms | 119 ms |
| grammars preloaded | 131 ms | 132 ms | 132 ms | 141 ms | 123 ms |
| file read from disk | 133 ms | 136 ms | 145 ms | 234 ms | 135 ms |
| file decoded | 133 ms | 136 ms | 145 ms | 234 ms | 135 ms |
| document built | 134 ms | 136 ms | 145 ms | 234 ms | 135 ms |
| tokenizer attached to editor | 155 ms | 164 ms | 183 ms | 273 ms | — |
| tabs opened | 137 ms | 141 ms | 153 ms | 244 ms | 152 ms |
| built-in extensions registered | 293 ms | 295 ms | 321 ms | 402 ms | 204 ms |
| frame with file text | 152 ms | 155 ms | 166 ms | 256 ms | 167 ms |
| frame with highlighting | 271 ms | 274 ms | 303 ms | 383 ms | — |
| extension host up | 506 ms | 523 ms | 607 ms | 1032 ms | 377 ms |
| startup complete | 286 ms | 289 ms | 316 ms | 396 ms | 198 ms |
| to text (black box) | 154 ms | 156 ms | 169 ms | 256 ms | 167 ms |
| to highlight (black box) | 272 ms | 275 ms | 303 ms | 383 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 2 ms | 0 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 33 ms | 14 ms | 10 ms | 13 ms | 18 ms | 8 ms | 3 ms |
| `medium` | 31 ms | 10 ms | 11 ms | 11 ms | 20 ms | 8 ms | 4 ms |
| `large` | 35 ms | 21 ms | 21 ms | 20 ms | 47 ms | 14 ms | 16 ms |
| `xlarge` | 25 ms | 23 ms | 13 ms | 16 ms | 203 ms | 15 ms | 84 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
