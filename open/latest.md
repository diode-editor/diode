# File open benchmark

- Recorded: 2026-10-21T19:38:21.839Z, commit `3d3c9a05ad0c`, diode nightly-3d3c9a0
- Machine: AMD EPYC 9V45 96-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 18 ms; binary floor (`diode --version` over PTY, median): 43 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **98 ms** | 73 ms | 116 ms | 193 ms | 5 ms | 244 MB | 11 |
| `medium` | 126.7 KB | 2000 | **129 ms** | 104 ms | 147 ms | 234 ms | 9 ms | 253 MB | 11 |
| `large` | 1.3 MB | 20000 | **230 ms** | 205 ms | 249 ms | 327 ms | 10 ms | 301 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **1073 ms** | 1048 ms | 1092 ms | 1218 ms | 37 ms | 505 MB | 5 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` |
| --- | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 7 ms | 8 ms | 10 ms |
| node ready (bootstrapComplete) | 48 ms | 54 ms | 57 ms | 64 ms |
| bundle executed (main:start) | 48 ms | 54 ms | 57 ms | 64 ms |
| config loaded | 63 ms | 69 ms | 70 ms | 85 ms |
| keybindings loaded | 63 ms | 71 ms | 70 ms | 85 ms |
| session state loaded | 63 ms | 71 ms | 70 ms | 86 ms |
| extensions scanned | 61 ms | 67 ms | 66 ms | 81 ms |
| themes ready | 65 ms | 73 ms | 72 ms | 89 ms |
| DI container created | 69 ms | 76 ms | 75 ms | 93 ms |
| workbench mounted | 89 ms | 98 ms | 95 ms | 116 ms |
| first frame | 89 ms | 98 ms | 95 ms | 116 ms |
| workbench activated | 92 ms | 102 ms | 99 ms | 120 ms |
| grammars preloaded | 97 ms | 108 ms | 107 ms | 128 ms |
| file read from disk | 97 ms | 109 ms | 115 ms | 189 ms |
| file decoded | 97 ms | 109 ms | 115 ms | 190 ms |
| document built | 98 ms | 110 ms | 116 ms | 190 ms |
| tokenizer attached to editor | 114 ms | 148 ms | 250 ms | 1092 ms |
| tabs opened | 101 ms | 117 ms | 130 ms | 219 ms |
| built-in extensions registered | 206 ms | 249 ms | 340 ms | 1232 ms |
| frame with file text | 114 ms | 146 ms | 249 ms | 1091 ms |
| frame with highlighting | 193 ms | 234 ms | 327 ms | 1218 ms |
| extension host up | 366 ms | 435 ms | 550 ms | 1658 ms |
| startup complete | 203 ms | 245 ms | 337 ms | 1229 ms |
| to text (black box) | 116 ms | 147 ms | 249 ms | 1092 ms |
| to highlight (black box) | 193 ms | 234 ms | 327 ms | 1218 ms |
| gap black − white (text) | 1 ms | 2 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 27 ms | 13 ms | 10 ms | 7 ms | 11 ms | 5 ms | 2 ms |
| `medium` | 37 ms | 15 ms | 14 ms | 11 ms | 12 ms | 7 ms | 3 ms |
| `large` | 50 ms | 39 ms | 37 ms | 47 ms | 54 ms | 11 ms | 11 ms |
| `xlarge` | 144 ms | 157 ms | 217 ms | 202 ms | 236 ms | 8 ms | 41 ms |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
