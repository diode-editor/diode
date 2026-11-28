# File open benchmark

- Recorded: 2026-11-28T15:14:44.382Z, commit `c4c522062cf8`, diode nightly-c4c5220
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1020-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 73 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **181 ms** | 133 ms | 206 ms | 320 ms | 12 ms | 298 MB | 11 |
| `medium` | 126.7 KB | 2000 | **181 ms** | 132 ms | 206 ms | 326 ms | 7 ms | 304 MB | 11 |
| `large` | 1.3 MB | 20000 | **197 ms** | 149 ms | 222 ms | 347 ms | 5 ms | 314 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **307 ms** | 259 ms | 333 ms | 429 ms | 4 ms | 363 MB | 5 |
| `log500m` | 497 MB | 5295839 | **199 ms** | 151 ms | 224 ms | — (plaintext) | 7 ms | 335 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 7 ms | 8 ms | 6 ms |
| node ready (bootstrapComplete) | 80 ms | 81 ms | 83 ms | 101 ms | 76 ms |
| bundle executed (main:start) | 80 ms | 81 ms | 83 ms | 101 ms | 76 ms |
| config loaded | 108 ms | 107 ms | 102 ms | 121 ms | 101 ms |
| keybindings loaded | 108 ms | 108 ms | 103 ms | 121 ms | 102 ms |
| session state loaded | 108 ms | 108 ms | 103 ms | 121 ms | 102 ms |
| extensions scanned | 99 ms | 98 ms | 96 ms | 114 ms | 94 ms |
| themes ready | 113 ms | 112 ms | 112 ms | 127 ms | 108 ms |
| DI container created | 116 ms | 116 ms | 117 ms | 134 ms | 113 ms |
| workbench mounted | 165 ms | 162 ms | 164 ms | 189 ms | 157 ms |
| first frame | 165 ms | 162 ms | 164 ms | 189 ms | 157 ms |
| workbench activated | 173 ms | 169 ms | 171 ms | 197 ms | 165 ms |
| grammars preloaded | 179 ms | 175 ms | 177 ms | 203 ms | 168 ms |
| file read from disk | 183 ms | 179 ms | 194 ms | 305 ms | 180 ms |
| file decoded | 183 ms | 179 ms | 194 ms | 305 ms | 180 ms |
| document built | 184 ms | 180 ms | 194 ms | 306 ms | 180 ms |
| tokenizer attached to editor | 205 ms | 206 ms | 222 ms | 334 ms | — |
| tabs opened | 188 ms | 186 ms | 204 ms | 315 ms | 203 ms |
| built-in extensions registered | 360 ms | 363 ms | 379 ms | 465 ms | 279 ms |
| frame with file text | 204 ms | 204 ms | 220 ms | 333 ms | 223 ms |
| frame with highlighting | 319 ms | 326 ms | 344 ms | 428 ms | — |
| extension host up | 619 ms | 666 ms | 739 ms | 1206 ms | 484 ms |
| startup complete | 347 ms | 351 ms | 367 ms | 451 ms | 265 ms |
| to text (black box) | 206 ms | 206 ms | 222 ms | 333 ms | 224 ms |
| to highlight (black box) | 320 ms | 326 ms | 347 ms | 429 ms | — |
| gap black − white (text) | 2 ms | 1 ms | 1 ms | 0 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 37 ms | 14 ms | 15 ms | 15 ms | — | 9 ms | 7 ms |
| `medium` failed | 35 ms | 22 ms | 13 ms | 11 ms | — | 7 ms | 6 ms |
| `large` failed | 43 ms | 33 ms | 28 ms | 27 ms | — | 21 ms | 21 ms |
| `xlarge` failed | 31 ms | 36 ms | 14 ms | 23 ms | — | 18 ms | 95 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
