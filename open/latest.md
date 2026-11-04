# File open benchmark

- Recorded: 2026-11-04T22:47:15.225Z, commit `b9c9eaf232d7`, diode nightly-b9c9eaf
- Machine: INTEL(R) XEON(R) PLATINUM 8573C (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 22 ms; binary floor (`diode --version` over PTY, median): 54 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **125 ms** | 92 ms | 146 ms | 250 ms | 4 ms | 258 MB | 11 |
| `medium` | 126.7 KB | 2000 | **128 ms** | 96 ms | 150 ms | 252 ms | 7 ms | 284 MB | 11 |
| `large` | 1.3 MB | 20000 | **139 ms** | 107 ms | 161 ms | 261 ms | 5 ms | 295 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **216 ms** | 184 ms | 238 ms | 325 ms | 15 ms | 349 MB | 5 |
| `log500m` | 497 MB | 5295839 | **129 ms** | 96 ms | 151 ms | — (plaintext) | 9 ms | 307 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 6 ms | 7 ms | 5 ms |
| node ready (bootstrapComplete) | 59 ms | 61 ms | 62 ms | 67 ms | 56 ms |
| bundle executed (main:start) | 60 ms | 61 ms | 62 ms | 67 ms | 56 ms |
| config loaded | 75 ms | 77 ms | 80 ms | 82 ms | 75 ms |
| keybindings loaded | 76 ms | 79 ms | 81 ms | 83 ms | 75 ms |
| session state loaded | 76 ms | 79 ms | 81 ms | 83 ms | 75 ms |
| extensions scanned | 72 ms | 73 ms | 76 ms | 77 ms | 70 ms |
| themes ready | 81 ms | 81 ms | 85 ms | 86 ms | 78 ms |
| DI container created | 84 ms | 85 ms | 88 ms | 89 ms | 81 ms |
| workbench mounted | 113 ms | 113 ms | 114 ms | 117 ms | 104 ms |
| first frame | 113 ms | 113 ms | 114 ms | 117 ms | 104 ms |
| workbench activated | 117 ms | 118 ms | 118 ms | 122 ms | 108 ms |
| grammars preloaded | 126 ms | 124 ms | 123 ms | 128 ms | 114 ms |
| file read from disk | 128 ms | 128 ms | 138 ms | 212 ms | 123 ms |
| file decoded | 128 ms | 128 ms | 138 ms | 212 ms | 123 ms |
| document built | 128 ms | 128 ms | 138 ms | 213 ms | 123 ms |
| tokenizer attached to editor | 145 ms | 149 ms | 160 ms | 236 ms | — |
| tabs opened | 131 ms | 135 ms | 146 ms | 221 ms | 136 ms |
| built-in extensions registered | 268 ms | 274 ms | 282 ms | 344 ms | 186 ms |
| frame with file text | 144 ms | 147 ms | 159 ms | 234 ms | 150 ms |
| frame with highlighting | 249 ms | 252 ms | 261 ms | 325 ms | — |
| extension host up | 470 ms | 500 ms | 568 ms | 980 ms | 351 ms |
| startup complete | 261 ms | 266 ms | 274 ms | 336 ms | 178 ms |
| to text (black box) | 146 ms | 150 ms | 161 ms | 238 ms | 151 ms |
| to highlight (black box) | 250 ms | 252 ms | 261 ms | 325 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 2 ms | 3 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 32 ms | 11 ms | 9 ms | 6 ms | — | 5 ms | 3 ms |
| `medium` failed | 29 ms | 13 ms | 11 ms | 11 ms | — | 6 ms | 5 ms |
| `large` failed | 32 ms | 29 ms | 23 ms | 20 ms | — | 14 ms | 14 ms |
| `xlarge` failed | 40 ms | 39 ms | 27 ms | 44 ms | — | 26 ms | 63 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
