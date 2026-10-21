# File open benchmark

- Recorded: 2026-10-21T21:37:46.094Z, commit `f3c833870762`, diode nightly-f3c8338
- Machine: INTEL(R) XEON(R) PLATINUM 8573C (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 20 ms; binary floor (`diode --version` over PTY, median): 48 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **113 ms** | 85 ms | 134 ms | 236 ms | 9 ms | 243 MB | 11 |
| `medium` | 126.7 KB | 2000 | **142 ms** | 114 ms | 162 ms | 261 ms | 7 ms | 247 MB | 11 |
| `large` | 1.3 MB | 20000 | **263 ms** | 235 ms | 283 ms | 377 ms | 14 ms | 302 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **1546 ms** | 1518 ms | 1566 ms | 1735 ms | 166 ms | 501 MB | 5 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` |
| --- | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 6 ms | 5 ms | 8 ms |
| node ready (bootstrapComplete) | 53 ms | 55 ms | 54 ms | 80 ms |
| bundle executed (main:start) | 53 ms | 55 ms | 54 ms | 80 ms |
| config loaded | 67 ms | 67 ms | 67 ms | 99 ms |
| keybindings loaded | 67 ms | 67 ms | 67 ms | 100 ms |
| session state loaded | 67 ms | 67 ms | 67 ms | 100 ms |
| extensions scanned | 64 ms | 65 ms | 65 ms | 94 ms |
| themes ready | 71 ms | 71 ms | 70 ms | 104 ms |
| DI container created | 75 ms | 75 ms | 74 ms | 108 ms |
| workbench mounted | 100 ms | 99 ms | 99 ms | 133 ms |
| first frame | 100 ms | 99 ms | 99 ms | 133 ms |
| workbench activated | 104 ms | 104 ms | 103 ms | 138 ms |
| grammars preloaded | 113 ms | 113 ms | 112 ms | 147 ms |
| file read from disk | 114 ms | 115 ms | 124 ms | 241 ms |
| file decoded | 114 ms | 115 ms | 124 ms | 241 ms |
| document built | 114 ms | 115 ms | 124 ms | 241 ms |
| tokenizer attached to editor | 134 ms | 160 ms | 285 ms | 1568 ms |
| tabs opened | 118 ms | 122 ms | 139 ms | 286 ms |
| built-in extensions registered | 250 ms | 275 ms | 391 ms | 1749 ms |
| frame with file text | 133 ms | 157 ms | 283 ms | 1566 ms |
| frame with highlighting | 236 ms | 260 ms | 377 ms | 1735 ms |
| extension host up | 434 ms | 470 ms | 603 ms | 2260 ms |
| startup complete | 246 ms | 271 ms | 387 ms | 1745 ms |
| to text (black box) | 134 ms | 162 ms | 283 ms | 1566 ms |
| to highlight (black box) | 236 ms | 261 ms | 377 ms | 1735 ms |
| gap black − white (text) | 1 ms | 2 ms | 2 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 36 ms | 13 ms | 9 ms | 7 ms | 13 ms | 6 ms | 2 ms |
| `medium` | 36 ms | 14 ms | 13 ms | 11 ms | 12 ms | 4 ms | 4 ms |
| `large` | 54 ms | 51 ms | 36 ms | 30 ms | 72 ms | 15 ms | 12 ms |
| `xlarge` | 253 ms | 325 ms | 330 ms | 232 ms | 266 ms | 13 ms | 78 ms |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
