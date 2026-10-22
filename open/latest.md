# File open benchmark

- Recorded: 2026-10-22T07:12:28.977Z, commit `9cf39c25a501`, diode nightly-9cf39c2
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 26 ms; binary floor (`diode --version` over PTY, median): 57 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **135 ms** | 104 ms | 161 ms | 275 ms | 6 ms | 244 MB | 11 |
| `medium` | 126.7 KB | 2000 | **167 ms** | 136 ms | 193 ms | 310 ms | 9 ms | 258 MB | 11 |
| `large` | 1.3 MB | 20000 | **328 ms** | 297 ms | 354 ms | 461 ms | 16 ms | 300 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **1563 ms** | 1531 ms | 1589 ms | 1765 ms | 24 ms | 504 MB | 5 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` |
| --- | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 7 ms | 10 ms |
| node ready (bootstrapComplete) | 63 ms | 65 ms | 67 ms | 89 ms |
| bundle executed (main:start) | 63 ms | 65 ms | 67 ms | 89 ms |
| config loaded | 81 ms | 84 ms | 85 ms | 122 ms |
| keybindings loaded | 81 ms | 84 ms | 85 ms | 122 ms |
| session state loaded | 81 ms | 85 ms | 85 ms | 123 ms |
| extensions scanned | 77 ms | 80 ms | 81 ms | 117 ms |
| themes ready | 86 ms | 88 ms | 89 ms | 128 ms |
| DI container created | 90 ms | 92 ms | 93 ms | 132 ms |
| workbench mounted | 121 ms | 122 ms | 127 ms | 161 ms |
| first frame | 121 ms | 122 ms | 127 ms | 160 ms |
| workbench activated | 127 ms | 128 ms | 133 ms | 166 ms |
| grammars preloaded | 136 ms | 137 ms | 142 ms | 172 ms |
| file read from disk | 137 ms | 140 ms | 154 ms | 258 ms |
| file decoded | 137 ms | 140 ms | 154 ms | 258 ms |
| document built | 137 ms | 140 ms | 154 ms | 258 ms |
| tokenizer attached to editor | 161 ms | 193 ms | 357 ms | 1591 ms |
| tabs opened | 142 ms | 150 ms | 173 ms | 298 ms |
| built-in extensions registered | 296 ms | 333 ms | 480 ms | 1784 ms |
| frame with file text | 160 ms | 191 ms | 354 ms | 1588 ms |
| frame with highlighting | 275 ms | 310 ms | 461 ms | 1765 ms |
| extension host up | 527 ms | 576 ms | 759 ms | 2362 ms |
| startup complete | 290 ms | 328 ms | 476 ms | 1779 ms |
| to text (black box) | 161 ms | 193 ms | 354 ms | 1589 ms |
| to highlight (black box) | 275 ms | 310 ms | 461 ms | 1765 ms |
| gap black − white (text) | 1 ms | 3 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 43 ms | 15 ms | 12 ms | 11 ms | 15 ms | 9 ms | 6 ms |
| `medium` | 45 ms | 15 ms | 15 ms | 13 ms | 15 ms | 8 ms | 6 ms |
| `large` | 76 ms | 73 ms | 49 ms | 64 ms | 69 ms | 15 ms | 16 ms |
| `xlarge` | 221 ms | 421 ms | 368 ms | 404 ms | 259 ms | 11 ms | 67 ms |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
