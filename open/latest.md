# File open benchmark

- Recorded: 2026-11-10T01:36:21.262Z, commit `fab4d676e370`, diode nightly-fab4d67
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 23 ms; binary floor (`diode --version` over PTY, median): 67 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **158 ms** | 114 ms | 182 ms | 299 ms | 11 ms | 280 MB | 11 |
| `medium` | 126.7 KB | 2000 | **172 ms** | 128 ms | 196 ms | 314 ms | 24 ms | 288 MB | 11 |
| `large` | 1.3 MB | 20000 | **184 ms** | 140 ms | 207 ms | 324 ms | 6 ms | 298 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **274 ms** | 230 ms | 297 ms | 398 ms | 16 ms | 354 MB | 5 |
| `log500m` | 497 MB | 5295839 | **177 ms** | 134 ms | 201 ms | — (plaintext) | 6 ms | 309 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 8 ms | 9 ms | 6 ms |
| node ready (bootstrapComplete) | 72 ms | 75 ms | 79 ms | 83 ms | 69 ms |
| bundle executed (main:start) | 72 ms | 75 ms | 79 ms | 83 ms | 69 ms |
| config loaded | 92 ms | 96 ms | 103 ms | 105 ms | 91 ms |
| keybindings loaded | 92 ms | 98 ms | 103 ms | 105 ms | 92 ms |
| session state loaded | 92 ms | 99 ms | 103 ms | 105 ms | 92 ms |
| extensions scanned | 88 ms | 91 ms | 98 ms | 101 ms | 85 ms |
| themes ready | 96 ms | 102 ms | 110 ms | 110 ms | 96 ms |
| DI container created | 101 ms | 106 ms | 113 ms | 114 ms | 100 ms |
| workbench mounted | 144 ms | 150 ms | 152 ms | 156 ms | 137 ms |
| first frame | 144 ms | 150 ms | 152 ms | 156 ms | 137 ms |
| workbench activated | 150 ms | 157 ms | 160 ms | 165 ms | 145 ms |
| grammars preloaded | 157 ms | 163 ms | 165 ms | 170 ms | 149 ms |
| file read from disk | 159 ms | 167 ms | 179 ms | 264 ms | 162 ms |
| file decoded | 159 ms | 167 ms | 179 ms | 264 ms | 162 ms |
| document built | 159 ms | 167 ms | 179 ms | 265 ms | 162 ms |
| tokenizer attached to editor | 185 ms | 196 ms | 209 ms | 297 ms | — |
| tabs opened | 163 ms | 175 ms | 189 ms | 275 ms | 183 ms |
| built-in extensions registered | 328 ms | 343 ms | 352 ms | 426 ms | 249 ms |
| frame with file text | 181 ms | 193 ms | 207 ms | 295 ms | 201 ms |
| frame with highlighting | 299 ms | 313 ms | 324 ms | 398 ms | — |
| extension host up | 584 ms | 651 ms | 724 ms | 1129 ms | 461 ms |
| startup complete | 318 ms | 333 ms | 343 ms | 416 ms | 239 ms |
| to text (black box) | 182 ms | 196 ms | 207 ms | 297 ms | 201 ms |
| to highlight (black box) | 299 ms | 314 ms | 324 ms | 398 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 2 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 38 ms | 16 ms | 11 ms | 13 ms | — | 7 ms | 4 ms |
| `medium` failed | 35 ms | 15 ms | 13 ms | 12 ms | — | 9 ms | 10 ms |
| `large` failed | 33 ms | 25 ms | 21 ms | 15 ms | — | 19 ms | 22 ms |
| `xlarge` failed | 38 ms | 43 ms | 30 ms | 35 ms | — | 22 ms | 82 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
