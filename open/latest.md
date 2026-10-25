# File open benchmark

- Recorded: 2026-10-25T17:11:20.977Z, commit `757210329fd8`, diode nightly-7572103
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 60 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **137 ms** | 102 ms | 162 ms | 278 ms | 9 ms | 244 MB | 11 |
| `medium` | 126.7 KB | 2000 | **142 ms** | 108 ms | 168 ms | 282 ms | 6 ms | 263 MB | 11 |
| `large` | 1.3 MB | 20000 | **154 ms** | 120 ms | 180 ms | 293 ms | 7 ms | 285 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **232 ms** | 198 ms | 258 ms | 360 ms | 3 ms | 348 MB | 5 |
| `log500m` | 497 MB | 5295839 | **151 ms** | 117 ms | 177 ms | — (plaintext) | 17 ms | 283 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 7 ms | 9 ms | 6 ms |
| node ready (bootstrapComplete) | 66 ms | 67 ms | 69 ms | 72 ms | 63 ms |
| bundle executed (main:start) | 66 ms | 67 ms | 69 ms | 72 ms | 63 ms |
| config loaded | 87 ms | 87 ms | 91 ms | 89 ms | 80 ms |
| keybindings loaded | 88 ms | 87 ms | 91 ms | 89 ms | 80 ms |
| session state loaded | 88 ms | 87 ms | 91 ms | 90 ms | 80 ms |
| extensions scanned | 83 ms | 83 ms | 86 ms | 85 ms | 76 ms |
| themes ready | 92 ms | 92 ms | 94 ms | 94 ms | 85 ms |
| DI container created | 96 ms | 97 ms | 99 ms | 98 ms | 89 ms |
| workbench mounted | 126 ms | 127 ms | 128 ms | 130 ms | 122 ms |
| first frame | 126 ms | 127 ms | 128 ms | 130 ms | 121 ms |
| workbench activated | 132 ms | 132 ms | 132 ms | 136 ms | 127 ms |
| grammars preloaded | 140 ms | 140 ms | 138 ms | 147 ms | 134 ms |
| file read from disk | 142 ms | 144 ms | 155 ms | 234 ms | 145 ms |
| file decoded | 142 ms | 144 ms | 155 ms | 234 ms | 145 ms |
| document built | 143 ms | 145 ms | 155 ms | 234 ms | 146 ms |
| tokenizer attached to editor | 162 ms | 167 ms | 181 ms | 259 ms | — |
| tabs opened | 146 ms | 150 ms | 165 ms | 243 ms | 164 ms |
| built-in extensions registered | 298 ms | 300 ms | 313 ms | 379 ms | 212 ms |
| frame with file text | 162 ms | 165 ms | 179 ms | 258 ms | 177 ms |
| frame with highlighting | 278 ms | 281 ms | 293 ms | 360 ms | — |
| extension host up | 524 ms | 544 ms | 621 ms | 943 ms | 391 ms |
| startup complete | 294 ms | 295 ms | 308 ms | 374 ms | 206 ms |
| to text (black box) | 162 ms | 168 ms | 180 ms | 258 ms | 177 ms |
| to highlight (black box) | 278 ms | 282 ms | 293 ms | 360 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 2 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 34 ms | 13 ms | 10 ms | 10 ms | 16 ms | 8 ms | 4 ms |
| `medium` | 32 ms | 13 ms | 11 ms | 9 ms | 17 ms | 9 ms | 8 ms |
| `large` | 38 ms | 20 ms | 15 ms | 21 ms | 37 ms | 18 ms | 17 ms |
| `xlarge` | 29 ms | 20 ms | 9 ms | 12 ms | 96 ms | 9 ms | 75 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
