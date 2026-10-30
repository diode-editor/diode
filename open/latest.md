# File open benchmark

- Recorded: 2026-10-30T13:00:11.513Z, commit `dd4c4845cb50`, diode nightly-dd4c484
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 26 ms; binary floor (`diode --version` over PTY, median): 61 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **141 ms** | 105 ms | 166 ms | 283 ms | 14 ms | 255 MB | 11 |
| `medium` | 126.7 KB | 2000 | **142 ms** | 106 ms | 168 ms | 287 ms | 3 ms | 280 MB | 11 |
| `large` | 1.3 MB | 20000 | **157 ms** | 122 ms | 183 ms | 314 ms | 13 ms | 297 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **241 ms** | 205 ms | 267 ms | 398 ms | 8 ms | 366 MB | 5 |
| `log500m` | 497 MB | 5295839 | **160 ms** | 124 ms | 185 ms | — (plaintext) | 4 ms | 269 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 7 ms | 7 ms | 6 ms |
| node ready (bootstrapComplete) | 65 ms | 65 ms | 68 ms | 75 ms | 62 ms |
| bundle executed (main:start) | 65 ms | 65 ms | 68 ms | 75 ms | 62 ms |
| config loaded | 84 ms | 82 ms | 86 ms | 94 ms | 80 ms |
| keybindings loaded | 84 ms | 83 ms | 87 ms | 94 ms | 81 ms |
| session state loaded | 84 ms | 83 ms | 87 ms | 94 ms | 81 ms |
| extensions scanned | 81 ms | 78 ms | 83 ms | 90 ms | 77 ms |
| themes ready | 88 ms | 87 ms | 91 ms | 98 ms | 86 ms |
| DI container created | 93 ms | 92 ms | 96 ms | 103 ms | 90 ms |
| workbench mounted | 125 ms | 126 ms | 128 ms | 138 ms | 124 ms |
| first frame | 125 ms | 126 ms | 127 ms | 138 ms | 124 ms |
| workbench activated | 133 ms | 134 ms | 133 ms | 142 ms | 130 ms |
| grammars preloaded | 140 ms | 141 ms | 143 ms | 148 ms | 137 ms |
| file read from disk | 143 ms | 145 ms | 158 ms | 243 ms | 150 ms |
| file decoded | 143 ms | 145 ms | 158 ms | 243 ms | 150 ms |
| document built | 143 ms | 145 ms | 158 ms | 244 ms | 150 ms |
| tokenizer attached to editor | 166 ms | 173 ms | 199 ms | 283 ms | — |
| tabs opened | 147 ms | 152 ms | 169 ms | 253 ms | 168 ms |
| built-in extensions registered | 309 ms | 313 ms | 337 ms | 420 ms | 225 ms |
| frame with file text | 164 ms | 166 ms | 183 ms | 267 ms | 183 ms |
| frame with highlighting | 283 ms | 286 ms | 314 ms | 398 ms | — |
| extension host up | 543 ms | 581 ms | 640 ms | 1083 ms | 406 ms |
| startup complete | 304 ms | 306 ms | 331 ms | 415 ms | 218 ms |
| to text (black box) | 166 ms | 168 ms | 183 ms | 267 ms | 185 ms |
| to highlight (black box) | 283 ms | 287 ms | 314 ms | 398 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 2 ms | 0 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 37 ms | 12 ms | 10 ms | 10 ms | 17 ms | 8 ms | 4 ms |
| `medium` | 34 ms | 12 ms | 11 ms | 8 ms | 16 ms | 7 ms | 4 ms |
| `large` | 38 ms | 24 ms | 17 ms | 25 ms | 41 ms | 14 ms | 15 ms |
| `xlarge` | 27 ms | 17 ms | 11 ms | 14 ms | 105 ms | 12 ms | 81 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
