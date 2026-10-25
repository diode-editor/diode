# File open benchmark

- Recorded: 2026-10-25T19:29:52.954Z, commit `1934cb9a3f18`, diode nightly-1934cb9
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 63 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **146 ms** | 108 ms | 171 ms | 292 ms | 13 ms | 244 MB | 11 |
| `medium` | 126.7 KB | 2000 | **143 ms** | 106 ms | 169 ms | 285 ms | 5 ms | 269 MB | 11 |
| `large` | 1.3 MB | 20000 | **158 ms** | 121 ms | 184 ms | 295 ms | 6 ms | 286 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **238 ms** | 200 ms | 263 ms | 366 ms | 5 ms | 351 MB | 5 |
| `log500m` | 497 MB | 5295839 | **156 ms** | 118 ms | 181 ms | — (plaintext) | 2 ms | 264 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 8 ms | 7 ms | 7 ms | 9 ms | 6 ms |
| node ready (bootstrapComplete) | 68 ms | 69 ms | 71 ms | 75 ms | 62 ms |
| bundle executed (main:start) | 68 ms | 69 ms | 71 ms | 75 ms | 62 ms |
| config loaded | 89 ms | 86 ms | 92 ms | 95 ms | 78 ms |
| keybindings loaded | 91 ms | 87 ms | 94 ms | 95 ms | 79 ms |
| session state loaded | 91 ms | 87 ms | 94 ms | 95 ms | 79 ms |
| extensions scanned | 86 ms | 83 ms | 88 ms | 92 ms | 75 ms |
| themes ready | 95 ms | 92 ms | 97 ms | 102 ms | 85 ms |
| DI container created | 100 ms | 97 ms | 101 ms | 106 ms | 90 ms |
| workbench mounted | 132 ms | 130 ms | 131 ms | 135 ms | 124 ms |
| first frame | 132 ms | 130 ms | 131 ms | 135 ms | 124 ms |
| workbench activated | 143 ms | 137 ms | 138 ms | 140 ms | 129 ms |
| grammars preloaded | 148 ms | 143 ms | 145 ms | 146 ms | 136 ms |
| file read from disk | 151 ms | 146 ms | 158 ms | 240 ms | 149 ms |
| file decoded | 151 ms | 146 ms | 158 ms | 240 ms | 149 ms |
| document built | 151 ms | 147 ms | 159 ms | 241 ms | 149 ms |
| tokenizer attached to editor | 172 ms | 170 ms | 185 ms | 265 ms | — |
| tabs opened | 155 ms | 153 ms | 169 ms | 249 ms | 167 ms |
| built-in extensions registered | 312 ms | 306 ms | 313 ms | 386 ms | 214 ms |
| frame with file text | 171 ms | 167 ms | 183 ms | 263 ms | 179 ms |
| frame with highlighting | 291 ms | 285 ms | 294 ms | 366 ms | — |
| extension host up | 540 ms | 561 ms | 626 ms | 957 ms | 397 ms |
| startup complete | 307 ms | 301 ms | 309 ms | 382 ms | 209 ms |
| to text (black box) | 171 ms | 169 ms | 184 ms | 263 ms | 181 ms |
| to highlight (black box) | 292 ms | 285 ms | 295 ms | 366 ms | — |
| gap black − white (text) | 2 ms | 1 ms | 1 ms | 0 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 38 ms | 12 ms | 10 ms | 10 ms | 17 ms | 7 ms | 4 ms |
| `medium` | 34 ms | 14 ms | 11 ms | 11 ms | 16 ms | 8 ms | 7 ms |
| `large` | 36 ms | 21 ms | 15 ms | 19 ms | 42 ms | 18 ms | 17 ms |
| `xlarge` | 29 ms | 17 ms | 8 ms | 10 ms | 94 ms | 8 ms | 77 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
