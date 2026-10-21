# File open benchmark

- Recorded: 2026-10-21T19:01:15.577Z, commit `474cbd3c745c`, diode nightly-474cbd3
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 26 ms; binary floor (`diode --version` over PTY, median): 60 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **142 ms** | 108 ms | 168 ms | 289 ms | 16 ms | 246 MB | 11 |
| `medium` | 126.7 KB | 2000 | **165 ms** | 132 ms | 191 ms | 309 ms | 8 ms | 270 MB | 11 |
| `large` | 1.3 MB | 20000 | **312 ms** | 279 ms | 339 ms | 447 ms | 28 ms | 300 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **1559 ms** | 1526 ms | 1586 ms | 1755 ms | 40 ms | 502 MB | 5 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` |
| --- | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 7 ms | 7 ms |
| node ready (bootstrapComplete) | 65 ms | 64 ms | 64 ms | 82 ms |
| bundle executed (main:start) | 65 ms | 64 ms | 64 ms | 82 ms |
| config loaded | 87 ms | 82 ms | 84 ms | 100 ms |
| keybindings loaded | 87 ms | 83 ms | 84 ms | 100 ms |
| session state loaded | 87 ms | 83 ms | 84 ms | 100 ms |
| extensions scanned | 82 ms | 78 ms | 80 ms | 95 ms |
| themes ready | 90 ms | 87 ms | 87 ms | 104 ms |
| DI container created | 94 ms | 91 ms | 93 ms | 108 ms |
| workbench mounted | 126 ms | 121 ms | 120 ms | 139 ms |
| first frame | 126 ms | 121 ms | 120 ms | 139 ms |
| workbench activated | 132 ms | 126 ms | 125 ms | 145 ms |
| grammars preloaded | 140 ms | 133 ms | 134 ms | 153 ms |
| file read from disk | 142 ms | 136 ms | 145 ms | 244 ms |
| file decoded | 142 ms | 136 ms | 145 ms | 244 ms |
| document built | 142 ms | 136 ms | 145 ms | 245 ms |
| tokenizer attached to editor | 168 ms | 191 ms | 340 ms | 1587 ms |
| tabs opened | 146 ms | 146 ms | 164 ms | 291 ms |
| built-in extensions registered | 309 ms | 329 ms | 467 ms | 1773 ms |
| frame with file text | 167 ms | 190 ms | 339 ms | 1585 ms |
| frame with highlighting | 288 ms | 309 ms | 447 ms | 1755 ms |
| extension host up | 572 ms | 572 ms | 744 ms | 2339 ms |
| startup complete | 303 ms | 323 ms | 461 ms | 1769 ms |
| to text (black box) | 168 ms | 191 ms | 339 ms | 1586 ms |
| to highlight (black box) | 289 ms | 309 ms | 447 ms | 1755 ms |
| gap black − white (text) | 1 ms | 2 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 47 ms | 15 ms | 15 ms | 10 ms | 17 ms | 9 ms | 7 ms |
| `medium` | 41 ms | 15 ms | 15 ms | 12 ms | 13 ms | 5 ms | 8 ms |
| `large` | 71 ms | 66 ms | 48 ms | 45 ms | 56 ms | 12 ms | 13 ms |
| `xlarge` | 259 ms | 407 ms | 370 ms | 374 ms | 259 ms | 13 ms | 71 ms |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
