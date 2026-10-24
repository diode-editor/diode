# File open benchmark

- Recorded: 2026-10-24T18:04:22.782Z, commit `dd51a5a43b45`, diode nightly-dd51a5a
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 61 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **140 ms** | 104 ms | 165 ms | 284 ms | 5 ms | 244 MB | 11 |
| `medium` | 126.7 KB | 2000 | **149 ms** | 113 ms | 174 ms | 289 ms | 24 ms | 260 MB | 11 |
| `large` | 1.3 MB | 20000 | **159 ms** | 123 ms | 184 ms | 306 ms | 8 ms | 282 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **256 ms** | 220 ms | 281 ms | 385 ms | 29 ms | 352 MB | 5 |
| `log500m` | 497 MB | 5295839 | **159 ms** | 123 ms | 184 ms | — (plaintext) | 7 ms | 282 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 7 ms | 9 ms | 6 ms |
| node ready (bootstrapComplete) | 67 ms | 68 ms | 72 ms | 81 ms | 63 ms |
| bundle executed (main:start) | 67 ms | 68 ms | 72 ms | 81 ms | 63 ms |
| config loaded | 86 ms | 90 ms | 93 ms | 101 ms | 84 ms |
| keybindings loaded | 86 ms | 90 ms | 95 ms | 101 ms | 85 ms |
| session state loaded | 86 ms | 90 ms | 95 ms | 101 ms | 85 ms |
| extensions scanned | 81 ms | 86 ms | 89 ms | 97 ms | 80 ms |
| themes ready | 90 ms | 95 ms | 98 ms | 105 ms | 88 ms |
| DI container created | 95 ms | 99 ms | 101 ms | 110 ms | 93 ms |
| workbench mounted | 127 ms | 130 ms | 131 ms | 139 ms | 122 ms |
| first frame | 127 ms | 130 ms | 131 ms | 139 ms | 122 ms |
| workbench activated | 132 ms | 136 ms | 137 ms | 145 ms | 127 ms |
| grammars preloaded | 142 ms | 147 ms | 144 ms | 150 ms | 129 ms |
| file read from disk | 145 ms | 151 ms | 159 ms | 257 ms | 145 ms |
| file decoded | 145 ms | 151 ms | 159 ms | 257 ms | 145 ms |
| document built | 145 ms | 151 ms | 159 ms | 258 ms | 145 ms |
| tokenizer attached to editor | 165 ms | 174 ms | 186 ms | 282 ms | — |
| tabs opened | 149 ms | 158 ms | 170 ms | 267 ms | 167 ms |
| built-in extensions registered | 303 ms | 308 ms | 325 ms | 404 ms | 223 ms |
| frame with file text | 164 ms | 171 ms | 183 ms | 280 ms | 183 ms |
| frame with highlighting | 283 ms | 288 ms | 305 ms | 385 ms | — |
| extension host up | 537 ms | 565 ms | 631 ms | 952 ms | 392 ms |
| startup complete | 298 ms | 303 ms | 320 ms | 399 ms | 217 ms |
| to text (black box) | 165 ms | 174 ms | 184 ms | 281 ms | 184 ms |
| to highlight (black box) | 284 ms | 289 ms | 306 ms | 385 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 2 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 37 ms | 11 ms | 8 ms | 11 ms | 15 ms | 8 ms | 4 ms |
| `medium` | 36 ms | 13 ms | 12 ms | 10 ms | 16 ms | 7 ms | 10 ms |
| `large` | 35 ms | 18 ms | 15 ms | 17 ms | 43 ms | 13 ms | 15 ms |
| `xlarge` | 31 ms | 27 ms | 12 ms | 14 ms | 111 ms | 15 ms | 83 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
