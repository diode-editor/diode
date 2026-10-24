# File open benchmark

- Recorded: 2026-10-24T13:52:12.405Z, commit `3d55556b8ef6`, diode nightly-3d55556
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 23 ms; binary floor (`diode --version` over PTY, median): 59 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **136 ms** | 99 ms | 159 ms | 271 ms | 11 ms | 247 MB | 11 |
| `medium` | 126.7 KB | 2000 | **139 ms** | 102 ms | 161 ms | 270 ms | 5 ms | 245 MB | 11 |
| `large` | 1.3 MB | 20000 | **154 ms** | 118 ms | 177 ms | 292 ms | 9 ms | 287 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **231 ms** | 195 ms | 254 ms | 357 ms | 4 ms | 350 MB | 5 |
| `log500m` | 497 MB | 5295839 | **156 ms** | 120 ms | 179 ms | — (plaintext) | 10 ms | 292 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 7 ms | 6 ms | 7 ms | 6 ms |
| node ready (bootstrapComplete) | 63 ms | 64 ms | 69 ms | 69 ms | 60 ms |
| bundle executed (main:start) | 63 ms | 64 ms | 69 ms | 69 ms | 60 ms |
| config loaded | 82 ms | 81 ms | 86 ms | 84 ms | 78 ms |
| keybindings loaded | 84 ms | 82 ms | 86 ms | 85 ms | 79 ms |
| session state loaded | 84 ms | 82 ms | 86 ms | 85 ms | 79 ms |
| extensions scanned | 79 ms | 78 ms | 83 ms | 81 ms | 74 ms |
| themes ready | 87 ms | 85 ms | 90 ms | 89 ms | 81 ms |
| DI container created | 91 ms | 90 ms | 95 ms | 93 ms | 88 ms |
| workbench mounted | 120 ms | 120 ms | 124 ms | 126 ms | 116 ms |
| first frame | 120 ms | 120 ms | 124 ms | 126 ms | 116 ms |
| workbench activated | 125 ms | 125 ms | 130 ms | 132 ms | 121 ms |
| grammars preloaded | 136 ms | 135 ms | 137 ms | 141 ms | 128 ms |
| file read from disk | 138 ms | 139 ms | 151 ms | 231 ms | 143 ms |
| file decoded | 138 ms | 139 ms | 151 ms | 231 ms | 143 ms |
| document built | 138 ms | 139 ms | 152 ms | 231 ms | 143 ms |
| tokenizer attached to editor | 159 ms | 161 ms | 178 ms | 255 ms | — |
| tabs opened | 142 ms | 145 ms | 162 ms | 240 ms | 163 ms |
| built-in extensions registered | 289 ms | 294 ms | 312 ms | 376 ms | 217 ms |
| frame with file text | 158 ms | 159 ms | 177 ms | 253 ms | 179 ms |
| frame with highlighting | 270 ms | 270 ms | 291 ms | 357 ms | — |
| extension host up | 518 ms | 533 ms | 617 ms | 905 ms | 407 ms |
| startup complete | 285 ms | 288 ms | 306 ms | 372 ms | 212 ms |
| to text (black box) | 159 ms | 161 ms | 177 ms | 254 ms | 179 ms |
| to highlight (black box) | 271 ms | 270 ms | 292 ms | 357 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 0 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 37 ms | 10 ms | 11 ms | 10 ms | 16 ms | 6 ms | 3 ms |
| `medium` | 37 ms | 12 ms | 12 ms | 8 ms | 16 ms | 7 ms | 6 ms |
| `large` | 30 ms | 20 ms | 21 ms | 20 ms | 46 ms | 13 ms | 15 ms |
| `xlarge` | 33 ms | 18 ms | 8 ms | 13 ms | 90 ms | 8 ms | 75 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
