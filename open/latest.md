# File open benchmark

- Recorded: 2026-11-25T00:27:55.015Z, commit `5a605d2fffc8`, diode nightly-5a605d2
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1020-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 24 ms; binary floor (`diode --version` over PTY, median): 71 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **177 ms** | 129 ms | 201 ms | 316 ms | 16 ms | 295 MB | 11 |
| `medium` | 126.7 KB | 2000 | **180 ms** | 132 ms | 203 ms | 327 ms | 12 ms | 303 MB | 11 |
| `large` | 1.3 MB | 20000 | **196 ms** | 149 ms | 220 ms | 335 ms | 7 ms | 314 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **289 ms** | 242 ms | 313 ms | 414 ms | 36 ms | 367 MB | 5 |
| `log500m` | 497 MB | 5295839 | **197 ms** | 149 ms | 221 ms | — (plaintext) | 5 ms | 334 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 8 ms | 9 ms | 5 ms |
| node ready (bootstrapComplete) | 76 ms | 79 ms | 82 ms | 93 ms | 74 ms |
| bundle executed (main:start) | 77 ms | 79 ms | 83 ms | 93 ms | 74 ms |
| config loaded | 102 ms | 104 ms | 104 ms | 115 ms | 95 ms |
| keybindings loaded | 102 ms | 104 ms | 104 ms | 115 ms | 96 ms |
| session state loaded | 102 ms | 104 ms | 105 ms | 115 ms | 96 ms |
| extensions scanned | 96 ms | 95 ms | 98 ms | 107 ms | 87 ms |
| themes ready | 107 ms | 109 ms | 111 ms | 123 ms | 103 ms |
| DI container created | 111 ms | 112 ms | 115 ms | 126 ms | 107 ms |
| workbench mounted | 161 ms | 159 ms | 165 ms | 181 ms | 154 ms |
| first frame | 161 ms | 159 ms | 165 ms | 181 ms | 154 ms |
| workbench activated | 169 ms | 167 ms | 172 ms | 191 ms | 161 ms |
| grammars preloaded | 175 ms | 173 ms | 178 ms | 196 ms | 164 ms |
| file read from disk | 177 ms | 177 ms | 191 ms | 288 ms | 175 ms |
| file decoded | 177 ms | 177 ms | 191 ms | 288 ms | 175 ms |
| document built | 177 ms | 177 ms | 191 ms | 288 ms | 175 ms |
| tokenizer attached to editor | 201 ms | 202 ms | 221 ms | 315 ms | — |
| tabs opened | 183 ms | 184 ms | 203 ms | 298 ms | 201 ms |
| built-in extensions registered | 351 ms | 361 ms | 368 ms | 449 ms | 272 ms |
| frame with file text | 200 ms | 201 ms | 219 ms | 313 ms | 219 ms |
| frame with highlighting | 315 ms | 327 ms | 335 ms | 414 ms | — |
| extension host up | 608 ms | 664 ms | 725 ms | 1168 ms | 468 ms |
| startup complete | 338 ms | 349 ms | 356 ms | 436 ms | 258 ms |
| to text (black box) | 201 ms | 203 ms | 220 ms | 313 ms | 221 ms |
| to highlight (black box) | 316 ms | 327 ms | 335 ms | 414 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 3 ms | 0 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 41 ms | 16 ms | 13 ms | 10 ms | — | 8 ms | 5 ms |
| `medium` failed | 34 ms | 17 ms | 12 ms | 13 ms | — | 9 ms | 8 ms |
| `large` failed | 42 ms | 23 ms | 23 ms | 22 ms | — | 15 ms | 17 ms |
| `xlarge` failed | 30 ms | 29 ms | 17 ms | 19 ms | — | 14 ms | 92 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
