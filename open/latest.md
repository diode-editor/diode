# File open benchmark

- Recorded: 2026-11-17T23:52:19.212Z, commit `0f7977264f7d`, diode nightly-0f79772
- Machine: INTEL(R) XEON(R) PLATINUM 8573C (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 21 ms; binary floor (`diode --version` over PTY, median): 61 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **134 ms** | 95 ms | 155 ms | 252 ms | 3 ms | 277 MB | 11 |
| `medium` | 126.7 KB | 2000 | **139 ms** | 100 ms | 160 ms | 254 ms | 4 ms | 296 MB | 11 |
| `large` | 1.3 MB | 20000 | **145 ms** | 106 ms | 167 ms | 259 ms | 2 ms | 309 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **215 ms** | 176 ms | 236 ms | 318 ms | 4 ms | 362 MB | 5 |
| `log500m` | 497 MB | 5295839 | **144 ms** | 105 ms | 165 ms | — (plaintext) | 6 ms | 287 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 5 ms | 5 ms | 6 ms | 4 ms |
| node ready (bootstrapComplete) | 62 ms | 62 ms | 63 ms | 69 ms | 60 ms |
| bundle executed (main:start) | 62 ms | 62 ms | 63 ms | 69 ms | 60 ms |
| config loaded | 76 ms | 77 ms | 79 ms | 84 ms | 77 ms |
| keybindings loaded | 76 ms | 77 ms | 80 ms | 86 ms | 77 ms |
| session state loaded | 76 ms | 77 ms | 80 ms | 86 ms | 77 ms |
| extensions scanned | 72 ms | 73 ms | 76 ms | 80 ms | 73 ms |
| themes ready | 81 ms | 81 ms | 83 ms | 90 ms | 81 ms |
| DI container created | 84 ms | 85 ms | 86 ms | 92 ms | 84 ms |
| workbench mounted | 120 ms | 121 ms | 120 ms | 123 ms | 117 ms |
| first frame | 120 ms | 121 ms | 120 ms | 123 ms | 117 ms |
| workbench activated | 132 ms | 133 ms | 129 ms | 136 ms | 124 ms |
| grammars preloaded | 136 ms | 138 ms | 132 ms | 139 ms | 131 ms |
| file read from disk | 138 ms | 141 ms | 142 ms | 216 ms | 139 ms |
| file decoded | 138 ms | 141 ms | 142 ms | 216 ms | 139 ms |
| document built | 138 ms | 141 ms | 143 ms | 216 ms | 139 ms |
| tokenizer attached to editor | 154 ms | 160 ms | 165 ms | 236 ms | — |
| tabs opened | 142 ms | 146 ms | 150 ms | 223 ms | 153 ms |
| built-in extensions registered | 271 ms | 274 ms | 279 ms | 337 ms | 197 ms |
| frame with file text | 153 ms | 158 ms | 163 ms | 234 ms | 165 ms |
| frame with highlighting | 252 ms | 254 ms | 259 ms | 318 ms | — |
| extension host up | 457 ms | 478 ms | 566 ms | 924 ms | 343 ms |
| startup complete | 265 ms | 266 ms | 271 ms | 329 ms | 188 ms |
| to text (black box) | 155 ms | 160 ms | 167 ms | 236 ms | 165 ms |
| to highlight (black box) | 252 ms | 254 ms | 259 ms | 318 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 3 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 33 ms | 10 ms | 7 ms | 6 ms | — | 5 ms | 3 ms |
| `medium` failed | 27 ms | 13 ms | 10 ms | 8 ms | — | 5 ms | 4 ms |
| `large` failed | 35 ms | 21 ms | 21 ms | 17 ms | — | 15 ms | 15 ms |
| `xlarge` failed | 25 ms | 32 ms | 18 ms | 22 ms | — | 13 ms | 71 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
