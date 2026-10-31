# File open benchmark

- Recorded: 2026-10-31T15:13:34.631Z, commit `f90c21f1ab61`, diode nightly-f90c21f
- Machine: INTEL(R) XEON(R) PLATINUM 8573C (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 23 ms; binary floor (`diode --version` over PTY, median): 59 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **124 ms** | 88 ms | 147 ms | 262 ms | 5 ms | 253 MB | 11 |
| `medium` | 126.7 KB | 2000 | **131 ms** | 95 ms | 155 ms | 269 ms | 5 ms | 279 MB | 11 |
| `large` | 1.3 MB | 20000 | **140 ms** | 104 ms | 163 ms | 292 ms | 5 ms | 300 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **224 ms** | 188 ms | 248 ms | 375 ms | 8 ms | 366 MB | 5 |
| `log500m` | 497 MB | 5295839 | **142 ms** | 106 ms | 166 ms | — (plaintext) | 2 ms | 269 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 6 ms | 6 ms | 9 ms | 4 ms |
| node ready (bootstrapComplete) | 61 ms | 61 ms | 62 ms | 69 ms | 62 ms |
| bundle executed (main:start) | 61 ms | 61 ms | 62 ms | 69 ms | 62 ms |
| config loaded | 77 ms | 78 ms | 77 ms | 84 ms | 75 ms |
| keybindings loaded | 77 ms | 78 ms | 78 ms | 84 ms | 75 ms |
| session state loaded | 77 ms | 78 ms | 78 ms | 84 ms | 75 ms |
| extensions scanned | 74 ms | 75 ms | 75 ms | 81 ms | 72 ms |
| themes ready | 82 ms | 83 ms | 83 ms | 88 ms | 80 ms |
| DI container created | 86 ms | 87 ms | 86 ms | 92 ms | 84 ms |
| workbench mounted | 113 ms | 115 ms | 114 ms | 121 ms | 115 ms |
| first frame | 113 ms | 115 ms | 114 ms | 121 ms | 115 ms |
| workbench activated | 118 ms | 120 ms | 119 ms | 126 ms | 119 ms |
| grammars preloaded | 126 ms | 130 ms | 127 ms | 136 ms | 125 ms |
| file read from disk | 128 ms | 133 ms | 139 ms | 225 ms | 135 ms |
| file decoded | 128 ms | 133 ms | 139 ms | 225 ms | 135 ms |
| document built | 128 ms | 133 ms | 139 ms | 225 ms | 135 ms |
| tokenizer attached to editor | 147 ms | 159 ms | 177 ms | 263 ms | — |
| tabs opened | 131 ms | 138 ms | 146 ms | 234 ms | 152 ms |
| built-in extensions registered | 282 ms | 289 ms | 310 ms | 392 ms | 198 ms |
| frame with file text | 145 ms | 153 ms | 160 ms | 247 ms | 165 ms |
| frame with highlighting | 261 ms | 269 ms | 291 ms | 375 ms | — |
| extension host up | 485 ms | 513 ms | 589 ms | 998 ms | 364 ms |
| startup complete | 276 ms | 283 ms | 304 ms | 386 ms | 192 ms |
| to text (black box) | 147 ms | 155 ms | 163 ms | 248 ms | 166 ms |
| to highlight (black box) | 262 ms | 269 ms | 292 ms | 375 ms | — |
| gap black − white (text) | 1 ms | 3 ms | 3 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 30 ms | 12 ms | 8 ms | 11 ms | 18 ms | 6 ms | 3 ms |
| `medium` | 32 ms | 12 ms | 13 ms | 9 ms | 17 ms | 6 ms | 4 ms |
| `large` | 43 ms | 26 ms | 24 ms | 15 ms | 40 ms | 13 ms | 13 ms |
| `xlarge` | 27 ms | 36 ms | 17 ms | 25 ms | 176 ms | 15 ms | 68 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
