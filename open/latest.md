# File open benchmark

- Recorded: 2026-11-01T01:46:17.749Z, commit `2fd0552742d4`, diode nightly-2fd0552
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 23 ms; binary floor (`diode --version` over PTY, median): 61 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **141 ms** | 103 ms | 164 ms | 276 ms | 9 ms | 255 MB | 11 |
| `medium` | 126.7 KB | 2000 | **143 ms** | 105 ms | 166 ms | 285 ms | 3 ms | 281 MB | 11 |
| `large` | 1.3 MB | 20000 | **157 ms** | 118 ms | 180 ms | 310 ms | 6 ms | 298 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **246 ms** | 208 ms | 269 ms | 409 ms | 10 ms | 366 MB | 5 |
| `log500m` | 497 MB | 5295839 | **154 ms** | 115 ms | 176 ms | — (plaintext) | 5 ms | 302 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 6 ms | 11 ms | 6 ms |
| node ready (bootstrapComplete) | 64 ms | 67 ms | 68 ms | 79 ms | 63 ms |
| bundle executed (main:start) | 64 ms | 67 ms | 68 ms | 79 ms | 63 ms |
| config loaded | 81 ms | 84 ms | 85 ms | 102 ms | 84 ms |
| keybindings loaded | 81 ms | 84 ms | 87 ms | 102 ms | 84 ms |
| session state loaded | 82 ms | 84 ms | 87 ms | 102 ms | 84 ms |
| extensions scanned | 77 ms | 81 ms | 82 ms | 97 ms | 78 ms |
| themes ready | 86 ms | 88 ms | 91 ms | 105 ms | 89 ms |
| DI container created | 91 ms | 92 ms | 95 ms | 109 ms | 92 ms |
| workbench mounted | 125 ms | 126 ms | 128 ms | 139 ms | 121 ms |
| first frame | 125 ms | 126 ms | 128 ms | 139 ms | 121 ms |
| workbench activated | 134 ms | 131 ms | 132 ms | 143 ms | 127 ms |
| grammars preloaded | 141 ms | 142 ms | 141 ms | 149 ms | 129 ms |
| file read from disk | 143 ms | 145 ms | 153 ms | 245 ms | 142 ms |
| file decoded | 143 ms | 145 ms | 153 ms | 245 ms | 142 ms |
| document built | 143 ms | 145 ms | 153 ms | 245 ms | 143 ms |
| tokenizer attached to editor | 163 ms | 173 ms | 196 ms | 286 ms | — |
| tabs opened | 147 ms | 151 ms | 165 ms | 256 ms | 162 ms |
| built-in extensions registered | 304 ms | 311 ms | 333 ms | 432 ms | 216 ms |
| frame with file text | 161 ms | 165 ms | 179 ms | 269 ms | 176 ms |
| frame with highlighting | 276 ms | 285 ms | 310 ms | 409 ms | — |
| extension host up | 534 ms | 578 ms | 644 ms | 1090 ms | 403 ms |
| startup complete | 299 ms | 305 ms | 327 ms | 426 ms | 210 ms |
| to text (black box) | 164 ms | 166 ms | 180 ms | 269 ms | 176 ms |
| to highlight (black box) | 276 ms | 285 ms | 310 ms | 409 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 30 ms | 11 ms | 10 ms | 10 ms | 17 ms | 6 ms | 3 ms |
| `medium` | 30 ms | 13 ms | 11 ms | 11 ms | 16 ms | 6 ms | 5 ms |
| `large` | 40 ms | 23 ms | 18 ms | 13 ms | 43 ms | 14 ms | 13 ms |
| `xlarge` | 29 ms | 20 ms | 11 ms | 14 ms | 128 ms | 11 ms | 75 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
