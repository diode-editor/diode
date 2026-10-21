# File open benchmark

- Recorded: 2026-10-21T21:43:16.958Z, commit `58cd78437160`, diode nightly-58cd784
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 26 ms; binary floor (`diode --version` over PTY, median): 59 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **134 ms** | 101 ms | 160 ms | 282 ms | 12 ms | 247 MB | 11 |
| `medium` | 126.7 KB | 2000 | **166 ms** | 133 ms | 192 ms | 307 ms | 12 ms | 247 MB | 11 |
| `large` | 1.3 MB | 20000 | **324 ms** | 292 ms | 351 ms | 465 ms | 26 ms | 298 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **1543 ms** | 1510 ms | 1569 ms | 1749 ms | 19 ms | 504 MB | 5 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` |
| --- | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 7 ms | 8 ms |
| node ready (bootstrapComplete) | 63 ms | 64 ms | 70 ms | 88 ms |
| bundle executed (main:start) | 63 ms | 64 ms | 70 ms | 88 ms |
| config loaded | 83 ms | 81 ms | 88 ms | 110 ms |
| keybindings loaded | 85 ms | 81 ms | 89 ms | 110 ms |
| session state loaded | 86 ms | 81 ms | 89 ms | 110 ms |
| extensions scanned | 80 ms | 76 ms | 84 ms | 104 ms |
| themes ready | 88 ms | 84 ms | 93 ms | 113 ms |
| DI container created | 92 ms | 90 ms | 98 ms | 119 ms |
| workbench mounted | 120 ms | 121 ms | 124 ms | 150 ms |
| first frame | 120 ms | 120 ms | 124 ms | 150 ms |
| workbench activated | 125 ms | 126 ms | 130 ms | 155 ms |
| grammars preloaded | 133 ms | 137 ms | 135 ms | 161 ms |
| file read from disk | 134 ms | 139 ms | 147 ms | 248 ms |
| file decoded | 134 ms | 139 ms | 147 ms | 248 ms |
| document built | 135 ms | 140 ms | 147 ms | 248 ms |
| tokenizer attached to editor | 160 ms | 190 ms | 352 ms | 1569 ms |
| tabs opened | 140 ms | 148 ms | 167 ms | 289 ms |
| built-in extensions registered | 303 ms | 329 ms | 482 ms | 1767 ms |
| frame with file text | 159 ms | 189 ms | 350 ms | 1567 ms |
| frame with highlighting | 281 ms | 307 ms | 464 ms | 1749 ms |
| extension host up | 531 ms | 570 ms | 759 ms | 2329 ms |
| startup complete | 298 ms | 324 ms | 478 ms | 1763 ms |
| to text (black box) | 160 ms | 192 ms | 351 ms | 1569 ms |
| to highlight (black box) | 282 ms | 307 ms | 465 ms | 1749 ms |
| gap black − white (text) | 1 ms | 2 ms | 0 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 47 ms | 20 ms | 19 ms | 11 ms | 19 ms | 9 ms | 5 ms |
| `medium` | 38 ms | 16 ms | 13 ms | 13 ms | 14 ms | 7 ms | 6 ms |
| `large` | 73 ms | 56 ms | 50 ms | 46 ms | 64 ms | 16 ms | 12 ms |
| `xlarge` | 247 ms | 403 ms | 364 ms | 386 ms | 225 ms | 10 ms | 66 ms |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
