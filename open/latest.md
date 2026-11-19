# File open benchmark

- Recorded: 2026-11-19T09:05:16.510Z, commit `d069e334e3d2`, diode nightly-d069e33
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 24 ms; binary floor (`diode --version` over PTY, median): 71 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **173 ms** | 126 ms | 197 ms | 312 ms | 19 ms | 293 MB | 11 |
| `medium` | 126.7 KB | 2000 | **170 ms** | 123 ms | 194 ms | 312 ms | 7 ms | 300 MB | 11 |
| `large` | 1.3 MB | 20000 | **190 ms** | 143 ms | 214 ms | 333 ms | 9 ms | 312 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **276 ms** | 228 ms | 300 ms | 403 ms | 12 ms | 360 MB | 5 |
| `log500m` | 497 MB | 5295839 | **195 ms** | 147 ms | 219 ms | — (plaintext) | 5 ms | 335 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 8 ms | 11 ms | 6 ms |
| node ready (bootstrapComplete) | 78 ms | 75 ms | 81 ms | 93 ms | 72 ms |
| bundle executed (main:start) | 78 ms | 75 ms | 81 ms | 93 ms | 72 ms |
| config loaded | 101 ms | 97 ms | 106 ms | 118 ms | 94 ms |
| keybindings loaded | 104 ms | 99 ms | 106 ms | 118 ms | 94 ms |
| session state loaded | 104 ms | 99 ms | 106 ms | 118 ms | 94 ms |
| extensions scanned | 95 ms | 91 ms | 99 ms | 112 ms | 88 ms |
| themes ready | 108 ms | 103 ms | 111 ms | 122 ms | 99 ms |
| DI container created | 111 ms | 106 ms | 115 ms | 125 ms | 104 ms |
| workbench mounted | 156 ms | 150 ms | 158 ms | 166 ms | 154 ms |
| first frame | 156 ms | 150 ms | 158 ms | 166 ms | 154 ms |
| workbench activated | 163 ms | 158 ms | 165 ms | 175 ms | 162 ms |
| grammars preloaded | 169 ms | 163 ms | 170 ms | 180 ms | 164 ms |
| file read from disk | 172 ms | 167 ms | 183 ms | 272 ms | 176 ms |
| file decoded | 172 ms | 167 ms | 183 ms | 272 ms | 176 ms |
| document built | 172 ms | 168 ms | 183 ms | 273 ms | 176 ms |
| tokenizer attached to editor | 197 ms | 196 ms | 213 ms | 301 ms | — |
| tabs opened | 177 ms | 176 ms | 194 ms | 283 ms | 200 ms |
| built-in extensions registered | 348 ms | 347 ms | 367 ms | 435 ms | 270 ms |
| frame with file text | 195 ms | 193 ms | 211 ms | 299 ms | 217 ms |
| frame with highlighting | 310 ms | 312 ms | 332 ms | 403 ms | — |
| extension host up | 605 ms | 652 ms | 724 ms | 1140 ms | 453 ms |
| startup complete | 335 ms | 334 ms | 354 ms | 425 ms | 256 ms |
| to text (black box) | 197 ms | 194 ms | 214 ms | 300 ms | 219 ms |
| to highlight (black box) | 312 ms | 312 ms | 333 ms | 403 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 3 ms | 1 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 38 ms | 20 ms | 10 ms | 8 ms | — | 6 ms | 5 ms |
| `medium` failed | 36 ms | 15 ms | 11 ms | 10 ms | — | 7 ms | 6 ms |
| `large` failed | 37 ms | 27 ms | 25 ms | 18 ms | — | 16 ms | 25 ms |
| `xlarge` failed | 27 ms | 30 ms | 17 ms | 14 ms | — | 15 ms | 116 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
