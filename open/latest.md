# File open benchmark

- Recorded: 2026-10-25T23:11:43.912Z, commit `26290c1fb466`, diode nightly-26290c1
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 62 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **144 ms** | 107 ms | 169 ms | 287 ms | 16 ms | 250 MB | 11 |
| `medium` | 126.7 KB | 2000 | **146 ms** | 109 ms | 171 ms | 281 ms | 6 ms | 265 MB | 11 |
| `large` | 1.3 MB | 20000 | **159 ms** | 122 ms | 184 ms | 301 ms | 6 ms | 282 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **251 ms** | 214 ms | 276 ms | 378 ms | 2 ms | 351 MB | 5 |
| `log500m` | 497 MB | 5295839 | **159 ms** | 122 ms | 185 ms | — (plaintext) | 4 ms | 265 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 8 ms | 9 ms | 6 ms |
| node ready (bootstrapComplete) | 68 ms | 68 ms | 72 ms | 79 ms | 64 ms |
| bundle executed (main:start) | 68 ms | 68 ms | 72 ms | 79 ms | 64 ms |
| config loaded | 88 ms | 86 ms | 91 ms | 99 ms | 82 ms |
| keybindings loaded | 89 ms | 88 ms | 92 ms | 99 ms | 82 ms |
| session state loaded | 89 ms | 88 ms | 92 ms | 99 ms | 82 ms |
| extensions scanned | 85 ms | 83 ms | 87 ms | 96 ms | 78 ms |
| themes ready | 94 ms | 92 ms | 97 ms | 103 ms | 86 ms |
| DI container created | 98 ms | 97 ms | 101 ms | 108 ms | 91 ms |
| workbench mounted | 133 ms | 131 ms | 130 ms | 150 ms | 125 ms |
| first frame | 133 ms | 131 ms | 130 ms | 150 ms | 125 ms |
| workbench activated | 139 ms | 138 ms | 140 ms | 156 ms | 131 ms |
| grammars preloaded | 146 ms | 147 ms | 145 ms | 162 ms | 138 ms |
| file read from disk | 148 ms | 151 ms | 159 ms | 255 ms | 150 ms |
| file decoded | 148 ms | 151 ms | 159 ms | 255 ms | 150 ms |
| document built | 149 ms | 151 ms | 160 ms | 255 ms | 150 ms |
| tokenizer attached to editor | 169 ms | 172 ms | 184 ms | 279 ms | — |
| tabs opened | 153 ms | 157 ms | 170 ms | 264 ms | 170 ms |
| built-in extensions registered | 308 ms | 301 ms | 321 ms | 397 ms | 219 ms |
| frame with file text | 168 ms | 171 ms | 183 ms | 276 ms | 182 ms |
| frame with highlighting | 285 ms | 281 ms | 301 ms | 378 ms | — |
| extension host up | 543 ms | 559 ms | 627 ms | 957 ms | 403 ms |
| startup complete | 302 ms | 296 ms | 315 ms | 392 ms | 213 ms |
| to text (black box) | 169 ms | 171 ms | 184 ms | 276 ms | 185 ms |
| to highlight (black box) | 287 ms | 281 ms | 301 ms | 378 ms | — |
| gap black − white (text) | 2 ms | 0 ms | 1 ms | 0 ms | 3 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 37 ms | 12 ms | 9 ms | 8 ms | 13 ms | 8 ms | 5 ms |
| `medium` | 37 ms | 15 ms | 10 ms | 7 ms | 15 ms | 7 ms | 5 ms |
| `large` | 43 ms | 19 ms | 18 ms | 19 ms | 42 ms | 17 ms | 15 ms |
| `xlarge` | 32 ms | 16 ms | 8 ms | 11 ms | 93 ms | 8 ms | 75 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
