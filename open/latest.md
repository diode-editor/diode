# File open benchmark

- Recorded: 2026-11-17T10:25:33.733Z, commit `99a3ae367521`, diode nightly-99a3ae3
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 22 ms; binary floor (`diode --version` over PTY, median): 63 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **137 ms** | 96 ms | 160 ms | 249 ms | 7 ms | 285 MB | 11 |
| `medium` | 126.7 KB | 2000 | **144 ms** | 103 ms | 166 ms | 258 ms | 6 ms | 293 MB | 11 |
| `large` | 1.3 MB | 20000 | **162 ms** | 121 ms | 184 ms | 271 ms | 7 ms | 306 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **227 ms** | 186 ms | 249 ms | 328 ms | 12 ms | 360 MB | 5 |
| `log500m` | 497 MB | 5295839 | **146 ms** | 105 ms | 169 ms | — (plaintext) | 8 ms | 315 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 7 ms | 9 ms | 5 ms |
| node ready (bootstrapComplete) | 65 ms | 70 ms | 70 ms | 85 ms | 64 ms |
| bundle executed (main:start) | 66 ms | 70 ms | 70 ms | 85 ms | 64 ms |
| config loaded | 85 ms | 90 ms | 88 ms | 102 ms | 80 ms |
| keybindings loaded | 85 ms | 90 ms | 88 ms | 103 ms | 83 ms |
| session state loaded | 85 ms | 90 ms | 89 ms | 103 ms | 83 ms |
| extensions scanned | 80 ms | 84 ms | 82 ms | 98 ms | 76 ms |
| themes ready | 89 ms | 95 ms | 93 ms | 107 ms | 87 ms |
| DI container created | 92 ms | 98 ms | 97 ms | 111 ms | 90 ms |
| workbench mounted | 126 ms | 130 ms | 135 ms | 149 ms | 120 ms |
| first frame | 126 ms | 130 ms | 135 ms | 149 ms | 120 ms |
| workbench activated | 134 ms | 138 ms | 144 ms | 161 ms | 127 ms |
| grammars preloaded | 138 ms | 142 ms | 150 ms | 166 ms | 129 ms |
| file read from disk | 140 ms | 144 ms | 163 ms | 229 ms | 139 ms |
| file decoded | 140 ms | 144 ms | 163 ms | 229 ms | 139 ms |
| document built | 140 ms | 145 ms | 163 ms | 229 ms | 139 ms |
| tokenizer attached to editor | 158 ms | 167 ms | 184 ms | 251 ms | — |
| tabs opened | 144 ms | 150 ms | 171 ms | 237 ms | 155 ms |
| built-in extensions registered | 273 ms | 283 ms | 293 ms | 349 ms | 202 ms |
| frame with file text | 157 ms | 164 ms | 182 ms | 249 ms | 168 ms |
| frame with highlighting | 249 ms | 258 ms | 270 ms | 328 ms | — |
| extension host up | 471 ms | 521 ms | 585 ms | 958 ms | 370 ms |
| startup complete | 264 ms | 274 ms | 286 ms | 343 ms | 194 ms |
| to text (black box) | 160 ms | 166 ms | 184 ms | 249 ms | 169 ms |
| to highlight (black box) | 249 ms | 258 ms | 271 ms | 328 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 2 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 31 ms | 18 ms | 10 ms | 8 ms | — | 5 ms | 3 ms |
| `medium` failed | 30 ms | 13 ms | 8 ms | 10 ms | — | 8 ms | 5 ms |
| `large` failed | 39 ms | 28 ms | 18 ms | 20 ms | — | 16 ms | 14 ms |
| `xlarge` failed | 30 ms | 36 ms | 27 ms | 26 ms | — | 16 ms | 59 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
