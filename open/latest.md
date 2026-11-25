# File open benchmark

- Recorded: 2026-11-25T02:02:51.466Z, commit `2e5881889b32`, diode nightly-2e58818
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1020-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 24 ms; binary floor (`diode --version` over PTY, median): 73 ms; for reference `node --version`: 5 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **179 ms** | 131 ms | 204 ms | 316 ms | 17 ms | 296 MB | 11 |
| `medium` | 126.7 KB | 2000 | **182 ms** | 133 ms | 206 ms | 321 ms | 8 ms | 303 MB | 11 |
| `large` | 1.3 MB | 20000 | **194 ms** | 146 ms | 219 ms | 333 ms | 13 ms | 313 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **275 ms** | 226 ms | 299 ms | 399 ms | 22 ms | 363 MB | 5 |
| `log500m` | 497 MB | 5295839 | **195 ms** | 146 ms | 219 ms | — (plaintext) | 3 ms | 340 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 6 ms | 7 ms | 12 ms | 6 ms |
| node ready (bootstrapComplete) | 79 ms | 78 ms | 80 ms | 94 ms | 74 ms |
| bundle executed (main:start) | 79 ms | 78 ms | 80 ms | 94 ms | 74 ms |
| config loaded | 107 ms | 103 ms | 106 ms | 117 ms | 101 ms |
| keybindings loaded | 107 ms | 103 ms | 106 ms | 118 ms | 101 ms |
| session state loaded | 107 ms | 103 ms | 106 ms | 118 ms | 101 ms |
| extensions scanned | 100 ms | 96 ms | 98 ms | 114 ms | 93 ms |
| themes ready | 111 ms | 107 ms | 114 ms | 124 ms | 106 ms |
| DI container created | 116 ms | 114 ms | 118 ms | 128 ms | 109 ms |
| workbench mounted | 162 ms | 161 ms | 163 ms | 170 ms | 155 ms |
| first frame | 162 ms | 161 ms | 163 ms | 170 ms | 154 ms |
| workbench activated | 169 ms | 168 ms | 170 ms | 177 ms | 162 ms |
| grammars preloaded | 175 ms | 174 ms | 176 ms | 182 ms | 165 ms |
| file read from disk | 178 ms | 179 ms | 191 ms | 274 ms | 176 ms |
| file decoded | 178 ms | 179 ms | 191 ms | 274 ms | 176 ms |
| document built | 178 ms | 179 ms | 191 ms | 274 ms | 177 ms |
| tokenizer attached to editor | 201 ms | 205 ms | 218 ms | 302 ms | — |
| tabs opened | 183 ms | 186 ms | 200 ms | 284 ms | 200 ms |
| built-in extensions registered | 350 ms | 355 ms | 365 ms | 431 ms | 268 ms |
| frame with file text | 200 ms | 204 ms | 216 ms | 299 ms | 215 ms |
| frame with highlighting | 316 ms | 321 ms | 332 ms | 398 ms | — |
| extension host up | 603 ms | 657 ms | 708 ms | 1151 ms | 464 ms |
| startup complete | 338 ms | 343 ms | 353 ms | 420 ms | 254 ms |
| to text (black box) | 204 ms | 206 ms | 219 ms | 299 ms | 219 ms |
| to highlight (black box) | 316 ms | 321 ms | 333 ms | 399 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 2 ms | 0 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 43 ms | 14 ms | 12 ms | 11 ms | — | 7 ms | 4 ms |
| `medium` failed | 34 ms | 16 ms | 12 ms | 13 ms | — | 7 ms | 9 ms |
| `large` failed | 39 ms | 26 ms | 30 ms | 24 ms | — | 17 ms | 17 ms |
| `xlarge` failed | 25 ms | 25 ms | 15 ms | 18 ms | — | 11 ms | 82 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
