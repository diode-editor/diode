# File open benchmark

- Recorded: 2026-10-22T00:49:32.443Z, commit `dcc6c03e6bc6`, diode nightly-dcc6c03
- Machine: Intel(R) Xeon(R) Platinum 8370C CPU @ 2.80GHz (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 56 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **137 ms** | 105 ms | 161 ms | 289 ms | 20 ms | 245 MB | 11 |
| `medium` | 126.7 KB | 2000 | **165 ms** | 133 ms | 189 ms | 308 ms | 10 ms | 248 MB | 11 |
| `large` | 1.3 MB | 20000 | **321 ms** | 290 ms | 346 ms | 451 ms | 8 ms | 304 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **1729 ms** | 1698 ms | 1754 ms | 1927 ms | 4 ms | 502 MB | 5 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` |
| --- | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 6 ms | 6 ms | 13 ms |
| node ready (bootstrapComplete) | 63 ms | 61 ms | 59 ms | 90 ms |
| bundle executed (main:start) | 63 ms | 61 ms | 59 ms | 90 ms |
| config loaded | 79 ms | 78 ms | 76 ms | 105 ms |
| keybindings loaded | 79 ms | 80 ms | 76 ms | 105 ms |
| session state loaded | 80 ms | 80 ms | 76 ms | 105 ms |
| extensions scanned | 76 ms | 75 ms | 70 ms | 102 ms |
| themes ready | 84 ms | 83 ms | 79 ms | 109 ms |
| DI container created | 89 ms | 87 ms | 82 ms | 113 ms |
| workbench mounted | 120 ms | 116 ms | 112 ms | 143 ms |
| first frame | 120 ms | 116 ms | 112 ms | 143 ms |
| workbench activated | 125 ms | 120 ms | 117 ms | 148 ms |
| grammars preloaded | 136 ms | 128 ms | 126 ms | 160 ms |
| file read from disk | 137 ms | 130 ms | 139 ms | 243 ms |
| file decoded | 138 ms | 130 ms | 139 ms | 244 ms |
| document built | 138 ms | 130 ms | 139 ms | 244 ms |
| tokenizer attached to editor | 160 ms | 189 ms | 347 ms | 1753 ms |
| tabs opened | 142 ms | 139 ms | 158 ms | 288 ms |
| built-in extensions registered | 305 ms | 324 ms | 466 ms | 1942 ms |
| frame with file text | 159 ms | 187 ms | 345 ms | 1751 ms |
| frame with highlighting | 289 ms | 308 ms | 451 ms | 1927 ms |
| extension host up | 519 ms | 555 ms | 720 ms | 2454 ms |
| startup complete | 300 ms | 319 ms | 461 ms | 1938 ms |
| to text (black box) | 161 ms | 189 ms | 346 ms | 1754 ms |
| to highlight (black box) | 289 ms | 308 ms | 451 ms | 1927 ms |
| gap black − white (text) | 1 ms | 2 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 38 ms | 13 ms | 14 ms | 12 ms | 15 ms | 11 ms | 4 ms |
| `medium` | 47 ms | 16 ms | 15 ms | 14 ms | 14 ms | 8 ms | 7 ms |
| `large` | 69 ms | 59 ms | 44 ms | 65 ms | 79 ms | 17 ms | 14 ms |
| `xlarge` | 241 ms | 473 ms | 385 ms | 354 ms | 236 ms | 12 ms | 79 ms |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
