# File open benchmark

- Recorded: 2026-10-22T09:51:20.337Z, commit `d29375fc3b6c`, diode nightly-d29375f
- Machine: INTEL(R) XEON(R) PLATINUM 8573C (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 22 ms; binary floor (`diode --version` over PTY, median): 53 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **129 ms** | 98 ms | 150 ms | 271 ms | 13 ms | 244 MB | 11 |
| `medium` | 126.7 KB | 2000 | **154 ms** | 124 ms | 176 ms | 295 ms | 6 ms | 263 MB | 11 |
| `large` | 1.3 MB | 20000 | **301 ms** | 270 ms | 323 ms | 449 ms | 13 ms | 327 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **1547 ms** | 1516 ms | 1569 ms | 1799 ms | 8 ms | 759 MB | 5 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` |
| --- | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 5 ms | 6 ms | 6 ms |
| node ready (bootstrapComplete) | 59 ms | 58 ms | 60 ms | 66 ms |
| bundle executed (main:start) | 59 ms | 58 ms | 60 ms | 66 ms |
| config loaded | 75 ms | 73 ms | 73 ms | 82 ms |
| keybindings loaded | 75 ms | 73 ms | 73 ms | 83 ms |
| session state loaded | 75 ms | 73 ms | 74 ms | 84 ms |
| extensions scanned | 73 ms | 69 ms | 71 ms | 78 ms |
| themes ready | 79 ms | 77 ms | 78 ms | 86 ms |
| DI container created | 83 ms | 81 ms | 82 ms | 90 ms |
| workbench mounted | 111 ms | 108 ms | 108 ms | 117 ms |
| first frame | 111 ms | 108 ms | 108 ms | 117 ms |
| workbench activated | 116 ms | 112 ms | 112 ms | 122 ms |
| grammars preloaded | 126 ms | 121 ms | 122 ms | 131 ms |
| file read from disk | 127 ms | 123 ms | 132 ms | 224 ms |
| file decoded | 127 ms | 123 ms | 132 ms | 224 ms |
| document built | 127 ms | 123 ms | 132 ms | 224 ms |
| tokenizer attached to editor | 149 ms | 177 ms | 325 ms | 1571 ms |
| tabs opened | 131 ms | 131 ms | 148 ms | 261 ms |
| built-in extensions registered | 289 ms | 309 ms | 466 ms | 1813 ms |
| frame with file text | 149 ms | 174 ms | 323 ms | 1569 ms |
| frame with highlighting | 270 ms | 294 ms | 448 ms | 1799 ms |
| extension host up | 486 ms | 515 ms | 711 ms | 2370 ms |
| startup complete | 284 ms | 304 ms | 459 ms | 1809 ms |
| to text (black box) | 150 ms | 176 ms | 323 ms | 1569 ms |
| to highlight (black box) | 271 ms | 295 ms | 449 ms | 1799 ms |
| gap black − white (text) | 2 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 43 ms | 17 ms | 10 ms | 10 ms | 13 ms | 8 ms | 3 ms |
| `medium` | 40 ms | 17 ms | 15 ms | 13 ms | 16 ms | 5 ms | 6 ms |
| `large` | 84 ms | 65 ms | 40 ms | 44 ms | 59 ms | 12 ms | 15 ms |
| `xlarge` | 276 ms | 617 ms | 471 ms | 304 ms | 424 ms | 17 ms | 66 ms |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
