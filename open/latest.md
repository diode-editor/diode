# File open benchmark

- Recorded: 2026-11-01T13:29:55.822Z, commit `5ddda24b873c`, diode nightly-5ddda24
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 62 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **144 ms** | 106 ms | 168 ms | 284 ms | 9 ms | 256 MB | 11 |
| `medium` | 126.7 KB | 2000 | **147 ms** | 110 ms | 172 ms | 292 ms | 7 ms | 282 MB | 11 |
| `large` | 1.3 MB | 20000 | **160 ms** | 123 ms | 185 ms | 314 ms | 2 ms | 291 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **246 ms** | 209 ms | 271 ms | 406 ms | 24 ms | 362 MB | 5 |
| `log500m` | 497 MB | 5295839 | **151 ms** | 114 ms | 176 ms | — (plaintext) | 6 ms | 299 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 6 ms | 6 ms | 9 ms | 6 ms |
| node ready (bootstrapComplete) | 67 ms | 68 ms | 68 ms | 80 ms | 63 ms |
| bundle executed (main:start) | 67 ms | 68 ms | 68 ms | 80 ms | 63 ms |
| config loaded | 86 ms | 89 ms | 85 ms | 99 ms | 81 ms |
| keybindings loaded | 86 ms | 89 ms | 85 ms | 100 ms | 83 ms |
| session state loaded | 86 ms | 89 ms | 86 ms | 101 ms | 83 ms |
| extensions scanned | 81 ms | 85 ms | 81 ms | 96 ms | 77 ms |
| themes ready | 90 ms | 93 ms | 91 ms | 105 ms | 87 ms |
| DI container created | 95 ms | 97 ms | 95 ms | 110 ms | 91 ms |
| workbench mounted | 129 ms | 131 ms | 131 ms | 146 ms | 121 ms |
| first frame | 129 ms | 131 ms | 131 ms | 146 ms | 121 ms |
| workbench activated | 139 ms | 138 ms | 138 ms | 157 ms | 126 ms |
| grammars preloaded | 144 ms | 145 ms | 144 ms | 162 ms | 128 ms |
| file read from disk | 147 ms | 149 ms | 157 ms | 247 ms | 141 ms |
| file decoded | 147 ms | 149 ms | 157 ms | 247 ms | 141 ms |
| document built | 147 ms | 149 ms | 158 ms | 248 ms | 141 ms |
| tokenizer attached to editor | 168 ms | 177 ms | 200 ms | 287 ms | — |
| tabs opened | 151 ms | 156 ms | 167 ms | 258 ms | 161 ms |
| built-in extensions registered | 310 ms | 316 ms | 339 ms | 428 ms | 220 ms |
| frame with file text | 166 ms | 171 ms | 183 ms | 271 ms | 176 ms |
| frame with highlighting | 284 ms | 291 ms | 314 ms | 406 ms | — |
| extension host up | 550 ms | 593 ms | 651 ms | 1087 ms | 406 ms |
| startup complete | 304 ms | 311 ms | 333 ms | 423 ms | 213 ms |
| to text (black box) | 168 ms | 172 ms | 185 ms | 271 ms | 176 ms |
| to highlight (black box) | 284 ms | 292 ms | 314 ms | 406 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 35 ms | 12 ms | 9 ms | 9 ms | 24 ms | 8 ms | 3 ms |
| `medium` | 32 ms | 14 ms | 13 ms | 10 ms | 21 ms | 6 ms | 5 ms |
| `large` | 33 ms | 17 ms | 20 ms | 16 ms | 42 ms | 13 ms | 19 ms |
| `xlarge` | 31 ms | 32 ms | 22 ms | 27 ms | 128 ms | 13 ms | 77 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
