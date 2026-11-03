# File open benchmark

- Recorded: 2026-11-03T12:08:55.902Z, commit `e082b0a6aa27`, diode nightly-e082b0a
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 23 ms; binary floor (`diode --version` over PTY, median): 63 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **145 ms** | 106 ms | 168 ms | 282 ms | 10 ms | 273 MB | 11 |
| `medium` | 126.7 KB | 2000 | **146 ms** | 106 ms | 169 ms | 287 ms | 9 ms | 282 MB | 11 |
| `large` | 1.3 MB | 20000 | **167 ms** | 127 ms | 190 ms | 305 ms | 5 ms | 295 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **251 ms** | 212 ms | 274 ms | 375 ms | 3 ms | 344 MB | 5 |
| `log500m` | 497 MB | 5295839 | **154 ms** | 115 ms | 177 ms | — (plaintext) | 5 ms | 305 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 6 ms | 7 ms | 8 ms | 6 ms |
| node ready (bootstrapComplete) | 69 ms | 67 ms | 72 ms | 84 ms | 63 ms |
| bundle executed (main:start) | 69 ms | 67 ms | 72 ms | 84 ms | 63 ms |
| config loaded | 89 ms | 88 ms | 92 ms | 102 ms | 81 ms |
| keybindings loaded | 89 ms | 88 ms | 92 ms | 102 ms | 84 ms |
| session state loaded | 90 ms | 88 ms | 92 ms | 102 ms | 84 ms |
| extensions scanned | 84 ms | 83 ms | 88 ms | 97 ms | 77 ms |
| themes ready | 94 ms | 93 ms | 97 ms | 106 ms | 87 ms |
| DI container created | 98 ms | 97 ms | 101 ms | 111 ms | 91 ms |
| workbench mounted | 129 ms | 128 ms | 134 ms | 145 ms | 124 ms |
| first frame | 129 ms | 128 ms | 134 ms | 145 ms | 124 ms |
| workbench activated | 134 ms | 133 ms | 140 ms | 150 ms | 129 ms |
| grammars preloaded | 140 ms | 140 ms | 150 ms | 157 ms | 132 ms |
| file read from disk | 143 ms | 145 ms | 163 ms | 249 ms | 145 ms |
| file decoded | 143 ms | 145 ms | 163 ms | 249 ms | 145 ms |
| document built | 143 ms | 145 ms | 163 ms | 250 ms | 146 ms |
| tokenizer attached to editor | 166 ms | 167 ms | 190 ms | 276 ms | — |
| tabs opened | 149 ms | 151 ms | 173 ms | 260 ms | 163 ms |
| built-in extensions registered | 308 ms | 311 ms | 328 ms | 398 ms | 221 ms |
| frame with file text | 165 ms | 165 ms | 188 ms | 274 ms | 177 ms |
| frame with highlighting | 282 ms | 287 ms | 304 ms | 375 ms | — |
| extension host up | 556 ms | 594 ms | 655 ms | 1099 ms | 412 ms |
| startup complete | 302 ms | 304 ms | 322 ms | 392 ms | 214 ms |
| to text (black box) | 168 ms | 169 ms | 190 ms | 274 ms | 177 ms |
| to highlight (black box) | 282 ms | 287 ms | 305 ms | 375 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 37 ms | 10 ms | 11 ms | 10 ms | — | 10 ms | 3 ms |
| `medium` failed | 32 ms | 13 ms | 8 ms | 8 ms | — | 6 ms | 5 ms |
| `large` failed | 41 ms | 28 ms | 22 ms | 20 ms | — | 16 ms | 19 ms |
| `xlarge` failed | 38 ms | 39 ms | 19 ms | 27 ms | — | 20 ms | 81 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
