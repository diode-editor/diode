# File open benchmark

- Recorded: 2026-11-08T22:20:02.795Z, commit `abe5a6bcf2d2`, diode nightly-abe5a6b
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 23 ms; binary floor (`diode --version` over PTY, median): 65 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **154 ms** | 113 ms | 178 ms | 291 ms | 10 ms | 280 MB | 11 |
| `medium` | 126.7 KB | 2000 | **159 ms** | 117 ms | 182 ms | 300 ms | 12 ms | 286 MB | 11 |
| `large` | 1.3 MB | 20000 | **183 ms** | 142 ms | 207 ms | 317 ms | 11 ms | 298 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **271 ms** | 230 ms | 295 ms | 391 ms | 13 ms | 351 MB | 5 |
| `log500m` | 497 MB | 5295839 | **171 ms** | 130 ms | 194 ms | — (plaintext) | 5 ms | 311 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 6 ms | 7 ms | 10 ms | 6 ms |
| node ready (bootstrapComplete) | 69 ms | 69 ms | 76 ms | 88 ms | 69 ms |
| bundle executed (main:start) | 69 ms | 69 ms | 76 ms | 88 ms | 69 ms |
| config loaded | 90 ms | 89 ms | 96 ms | 109 ms | 91 ms |
| keybindings loaded | 90 ms | 90 ms | 96 ms | 110 ms | 91 ms |
| session state loaded | 90 ms | 90 ms | 96 ms | 110 ms | 92 ms |
| extensions scanned | 85 ms | 85 ms | 90 ms | 105 ms | 84 ms |
| themes ready | 94 ms | 94 ms | 101 ms | 114 ms | 95 ms |
| DI container created | 99 ms | 98 ms | 104 ms | 118 ms | 98 ms |
| workbench mounted | 139 ms | 138 ms | 153 ms | 156 ms | 135 ms |
| first frame | 139 ms | 138 ms | 153 ms | 156 ms | 135 ms |
| workbench activated | 146 ms | 145 ms | 160 ms | 163 ms | 142 ms |
| grammars preloaded | 153 ms | 151 ms | 166 ms | 170 ms | 145 ms |
| file read from disk | 157 ms | 156 ms | 178 ms | 271 ms | 157 ms |
| file decoded | 157 ms | 156 ms | 178 ms | 271 ms | 157 ms |
| document built | 157 ms | 156 ms | 179 ms | 271 ms | 157 ms |
| tokenizer attached to editor | 176 ms | 184 ms | 206 ms | 296 ms | — |
| tabs opened | 162 ms | 163 ms | 189 ms | 281 ms | 178 ms |
| built-in extensions registered | 321 ms | 329 ms | 345 ms | 419 ms | 240 ms |
| frame with file text | 176 ms | 180 ms | 204 ms | 295 ms | 194 ms |
| frame with highlighting | 291 ms | 300 ms | 317 ms | 391 ms | — |
| extension host up | 569 ms | 619 ms | 704 ms | 1125 ms | 452 ms |
| startup complete | 312 ms | 321 ms | 336 ms | 409 ms | 228 ms |
| to text (black box) | 178 ms | 182 ms | 207 ms | 295 ms | 194 ms |
| to highlight (black box) | 291 ms | 300 ms | 317 ms | 391 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 0 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 36 ms | 12 ms | 13 ms | 11 ms | — | 8 ms | 4 ms |
| `medium` failed | 31 ms | 15 ms | 11 ms | 11 ms | — | 8 ms | 6 ms |
| `large` failed | 38 ms | 22 ms | 20 ms | 18 ms | — | 15 ms | 19 ms |
| `xlarge` failed | 30 ms | 33 ms | 17 ms | 38 ms | — | 24 ms | 80 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
