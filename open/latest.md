# File open benchmark

- Recorded: 2026-11-10T09:00:43.665Z, commit `3ce897708da5`, diode nightly-3ce8977
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 29 ms; binary floor (`diode --version` over PTY, median): 79 ms; for reference `node --version`: 6 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **182 ms** | 132 ms | 211 ms | 335 ms | 25 ms | 278 MB | 11 |
| `medium` | 126.7 KB | 2000 | **200 ms** | 150 ms | 229 ms | 357 ms | 21 ms | 288 MB | 11 |
| `large` | 1.3 MB | 20000 | **205 ms** | 156 ms | 234 ms | 361 ms | 9 ms | 298 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **270 ms** | 221 ms | 299 ms | 405 ms | 13 ms | 353 MB | 5 |
| `log500m` | 497 MB | 5295839 | **218 ms** | 168 ms | 247 ms | — (plaintext) | 5 ms | 309 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 8 ms | 10 ms | 10 ms | 10 ms | 8 ms |
| node ready (bootstrapComplete) | 85 ms | 91 ms | 93 ms | 89 ms | 85 ms |
| bundle executed (main:start) | 85 ms | 91 ms | 93 ms | 89 ms | 86 ms |
| config loaded | 113 ms | 117 ms | 119 ms | 115 ms | 112 ms |
| keybindings loaded | 113 ms | 119 ms | 119 ms | 115 ms | 112 ms |
| session state loaded | 113 ms | 119 ms | 120 ms | 115 ms | 112 ms |
| extensions scanned | 106 ms | 111 ms | 112 ms | 111 ms | 103 ms |
| themes ready | 117 ms | 125 ms | 124 ms | 123 ms | 118 ms |
| DI container created | 121 ms | 130 ms | 127 ms | 127 ms | 124 ms |
| workbench mounted | 163 ms | 173 ms | 174 ms | 168 ms | 176 ms |
| first frame | 163 ms | 173 ms | 174 ms | 168 ms | 176 ms |
| workbench activated | 172 ms | 182 ms | 182 ms | 176 ms | 186 ms |
| grammars preloaded | 179 ms | 189 ms | 188 ms | 182 ms | 189 ms |
| file read from disk | 183 ms | 194 ms | 202 ms | 268 ms | 203 ms |
| file decoded | 183 ms | 194 ms | 202 ms | 268 ms | 203 ms |
| document built | 183 ms | 194 ms | 202 ms | 268 ms | 203 ms |
| tokenizer attached to editor | 210 ms | 228 ms | 234 ms | 299 ms | — |
| tabs opened | 190 ms | 203 ms | 212 ms | 278 ms | 226 ms |
| built-in extensions registered | 364 ms | 388 ms | 390 ms | 434 ms | 299 ms |
| frame with file text | 208 ms | 227 ms | 232 ms | 297 ms | 246 ms |
| frame with highlighting | 335 ms | 355 ms | 361 ms | 404 ms | — |
| extension host up | 651 ms | 732 ms | 770 ms | 1168 ms | 557 ms |
| startup complete | 354 ms | 377 ms | 380 ms | 423 ms | 286 ms |
| to text (black box) | 211 ms | 229 ms | 234 ms | 299 ms | 247 ms |
| to highlight (black box) | 335 ms | 357 ms | 361 ms | 405 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 1 ms | 2 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 40 ms | 18 ms | 16 ms | 13 ms | — | 9 ms | 4 ms |
| `medium` failed | 37 ms | 21 ms | 15 ms | 16 ms | — | 8 ms | 9 ms |
| `large` failed | 48 ms | 27 ms | 25 ms | 22 ms | — | 19 ms | 18 ms |
| `xlarge` failed | 28 ms | 44 ms | 27 ms | 61 ms | — | 29 ms | 91 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
