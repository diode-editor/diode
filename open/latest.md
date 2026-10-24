# File open benchmark

- Recorded: 2026-10-24T14:36:01.802Z, commit `42ed3181d12a`, diode nightly-42ed318
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 59 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **143 ms** | 109 ms | 167 ms | 287 ms | 10 ms | 243 MB | 11 |
| `medium` | 126.7 KB | 2000 | **142 ms** | 108 ms | 167 ms | 282 ms | 6 ms | 256 MB | 11 |
| `large` | 1.3 MB | 20000 | **158 ms** | 123 ms | 182 ms | 302 ms | 10 ms | 287 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **251 ms** | 217 ms | 276 ms | 378 ms | 10 ms | 351 MB | 5 |
| `log500m` | 497 MB | 5295839 | **149 ms** | 115 ms | 173 ms | — (plaintext) | 8 ms | 284 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 7 ms | 9 ms | 7 ms |
| node ready (bootstrapComplete) | 66 ms | 66 ms | 69 ms | 80 ms | 62 ms |
| bundle executed (main:start) | 66 ms | 67 ms | 69 ms | 80 ms | 62 ms |
| config loaded | 85 ms | 84 ms | 89 ms | 102 ms | 80 ms |
| keybindings loaded | 85 ms | 85 ms | 90 ms | 102 ms | 82 ms |
| session state loaded | 85 ms | 85 ms | 90 ms | 102 ms | 82 ms |
| extensions scanned | 82 ms | 81 ms | 86 ms | 97 ms | 75 ms |
| themes ready | 89 ms | 89 ms | 95 ms | 105 ms | 85 ms |
| DI container created | 94 ms | 94 ms | 101 ms | 109 ms | 89 ms |
| workbench mounted | 126 ms | 125 ms | 131 ms | 143 ms | 120 ms |
| first frame | 126 ms | 125 ms | 131 ms | 143 ms | 120 ms |
| workbench activated | 132 ms | 130 ms | 136 ms | 149 ms | 125 ms |
| grammars preloaded | 142 ms | 139 ms | 144 ms | 159 ms | 127 ms |
| file read from disk | 145 ms | 144 ms | 158 ms | 251 ms | 140 ms |
| file decoded | 145 ms | 144 ms | 158 ms | 251 ms | 140 ms |
| document built | 145 ms | 144 ms | 158 ms | 252 ms | 140 ms |
| tokenizer attached to editor | 166 ms | 166 ms | 185 ms | 278 ms | — |
| tabs opened | 149 ms | 150 ms | 167 ms | 261 ms | 160 ms |
| built-in extensions registered | 307 ms | 302 ms | 322 ms | 397 ms | 210 ms |
| frame with file text | 165 ms | 164 ms | 182 ms | 276 ms | 173 ms |
| frame with highlighting | 287 ms | 282 ms | 302 ms | 378 ms | — |
| extension host up | 541 ms | 554 ms | 625 ms | 967 ms | 395 ms |
| startup complete | 303 ms | 297 ms | 317 ms | 392 ms | 204 ms |
| to text (black box) | 167 ms | 167 ms | 182 ms | 276 ms | 173 ms |
| to highlight (black box) | 287 ms | 282 ms | 302 ms | 378 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 39 ms | 12 ms | 11 ms | 10 ms | 21 ms | 8 ms | 4 ms |
| `medium` | 39 ms | 14 ms | 10 ms | 10 ms | 13 ms | 6 ms | 6 ms |
| `large` | 38 ms | 19 ms | 19 ms | 19 ms | 41 ms | 15 ms | 16 ms |
| `xlarge` | 28 ms | 23 ms | 11 ms | 14 ms | 99 ms | 13 ms | 97 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
