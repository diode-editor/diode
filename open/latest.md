# File open benchmark

- Recorded: 2026-11-03T21:48:28.039Z, commit `8c18eda0fdc5`, diode nightly-8c18eda
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 26 ms; binary floor (`diode --version` over PTY, median): 64 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **157 ms** | 118 ms | 183 ms | 298 ms | 14 ms | 271 MB | 11 |
| `medium` | 126.7 KB | 2000 | **153 ms** | 114 ms | 179 ms | 290 ms | 8 ms | 282 MB | 11 |
| `large` | 1.3 MB | 20000 | **165 ms** | 127 ms | 191 ms | 303 ms | 9 ms | 291 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **257 ms** | 218 ms | 283 ms | 379 ms | 14 ms | 347 MB | 5 |
| `log500m` | 497 MB | 5295839 | **162 ms** | 124 ms | 188 ms | — (plaintext) | 18 ms | 273 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 9 ms | 9 ms | 6 ms |
| node ready (bootstrapComplete) | 72 ms | 70 ms | 74 ms | 86 ms | 66 ms |
| bundle executed (main:start) | 72 ms | 70 ms | 74 ms | 86 ms | 66 ms |
| config loaded | 91 ms | 87 ms | 93 ms | 110 ms | 85 ms |
| keybindings loaded | 92 ms | 88 ms | 94 ms | 111 ms | 85 ms |
| session state loaded | 92 ms | 88 ms | 94 ms | 111 ms | 86 ms |
| extensions scanned | 87 ms | 82 ms | 89 ms | 105 ms | 82 ms |
| themes ready | 96 ms | 93 ms | 98 ms | 114 ms | 89 ms |
| DI container created | 100 ms | 97 ms | 102 ms | 117 ms | 93 ms |
| workbench mounted | 139 ms | 134 ms | 139 ms | 148 ms | 129 ms |
| first frame | 139 ms | 134 ms | 139 ms | 148 ms | 129 ms |
| workbench activated | 149 ms | 144 ms | 148 ms | 154 ms | 134 ms |
| grammars preloaded | 155 ms | 150 ms | 154 ms | 160 ms | 142 ms |
| file read from disk | 159 ms | 154 ms | 167 ms | 255 ms | 153 ms |
| file decoded | 159 ms | 154 ms | 167 ms | 255 ms | 153 ms |
| document built | 159 ms | 154 ms | 167 ms | 256 ms | 153 ms |
| tokenizer attached to editor | 182 ms | 179 ms | 193 ms | 282 ms | — |
| tabs opened | 164 ms | 161 ms | 176 ms | 266 ms | 172 ms |
| built-in extensions registered | 323 ms | 319 ms | 326 ms | 402 ms | 228 ms |
| frame with file text | 181 ms | 176 ms | 191 ms | 280 ms | 188 ms |
| frame with highlighting | 298 ms | 290 ms | 303 ms | 378 ms | — |
| extension host up | 571 ms | 598 ms | 669 ms | 1114 ms | 421 ms |
| startup complete | 316 ms | 310 ms | 321 ms | 396 ms | 222 ms |
| to text (black box) | 183 ms | 179 ms | 191 ms | 283 ms | 188 ms |
| to highlight (black box) | 298 ms | 290 ms | 303 ms | 379 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 0 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 39 ms | 17 ms | 11 ms | 9 ms | — | 7 ms | 5 ms |
| `medium` failed | 33 ms | 15 ms | 10 ms | 10 ms | — | 7 ms | 5 ms |
| `large` failed | 39 ms | 20 ms | 21 ms | 17 ms | — | 15 ms | 17 ms |
| `xlarge` failed | 28 ms | 33 ms | 21 ms | 25 ms | — | 12 ms | 85 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
