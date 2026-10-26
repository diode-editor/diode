# File open benchmark

- Recorded: 2026-10-26T00:12:32.799Z, commit `9029f91744d6`, diode nightly-9029f91
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 24 ms; binary floor (`diode --version` over PTY, median): 60 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **142 ms** | 106 ms | 166 ms | 289 ms | 16 ms | 257 MB | 11 |
| `medium` | 126.7 KB | 2000 | **144 ms** | 108 ms | 168 ms | 282 ms | 8 ms | 266 MB | 11 |
| `large` | 1.3 MB | 20000 | **156 ms** | 120 ms | 180 ms | 296 ms | 7 ms | 289 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **253 ms** | 216 ms | 277 ms | 383 ms | 13 ms | 349 MB | 5 |
| `log500m` | 497 MB | 5295839 | **150 ms** | 113 ms | 174 ms | — (plaintext) | 1 ms | 296 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 7 ms | 9 ms | 6 ms |
| node ready (bootstrapComplete) | 67 ms | 67 ms | 71 ms | 82 ms | 60 ms |
| bundle executed (main:start) | 67 ms | 67 ms | 71 ms | 82 ms | 60 ms |
| config loaded | 87 ms | 87 ms | 86 ms | 100 ms | 84 ms |
| keybindings loaded | 87 ms | 88 ms | 87 ms | 102 ms | 84 ms |
| session state loaded | 87 ms | 88 ms | 87 ms | 102 ms | 84 ms |
| extensions scanned | 82 ms | 83 ms | 83 ms | 97 ms | 81 ms |
| themes ready | 92 ms | 92 ms | 92 ms | 105 ms | 87 ms |
| DI container created | 97 ms | 96 ms | 96 ms | 109 ms | 90 ms |
| workbench mounted | 128 ms | 127 ms | 130 ms | 143 ms | 121 ms |
| first frame | 128 ms | 127 ms | 130 ms | 143 ms | 121 ms |
| workbench activated | 133 ms | 134 ms | 136 ms | 148 ms | 125 ms |
| grammars preloaded | 139 ms | 143 ms | 145 ms | 159 ms | 129 ms |
| file read from disk | 142 ms | 146 ms | 157 ms | 255 ms | 142 ms |
| file decoded | 142 ms | 146 ms | 157 ms | 255 ms | 142 ms |
| document built | 143 ms | 147 ms | 157 ms | 256 ms | 142 ms |
| tokenizer attached to editor | 167 ms | 168 ms | 180 ms | 278 ms | — |
| tabs opened | 147 ms | 152 ms | 166 ms | 265 ms | 162 ms |
| built-in extensions registered | 308 ms | 303 ms | 314 ms | 401 ms | 212 ms |
| frame with file text | 166 ms | 167 ms | 179 ms | 277 ms | 174 ms |
| frame with highlighting | 288 ms | 281 ms | 295 ms | 383 ms | — |
| extension host up | 524 ms | 546 ms | 606 ms | 945 ms | 388 ms |
| startup complete | 304 ms | 299 ms | 310 ms | 397 ms | 207 ms |
| to text (black box) | 166 ms | 168 ms | 180 ms | 277 ms | 174 ms |
| to highlight (black box) | 289 ms | 282 ms | 296 ms | 383 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 36 ms | 11 ms | 11 ms | 11 ms | 16 ms | 8 ms | 5 ms |
| `medium` | 30 ms | 13 ms | 9 ms | 10 ms | 16 ms | 7 ms | 6 ms |
| `large` | 33 ms | 26 ms | 20 ms | 23 ms | 51 ms | 14 ms | 15 ms |
| `xlarge` | 27 ms | 20 ms | 12 ms | 12 ms | 104 ms | 8 ms | 73 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
