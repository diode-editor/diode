# File open benchmark

- Recorded: 2026-11-18T02:42:53.909Z, commit `3245628ac23f`, diode nightly-3245628
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 20 ms; binary floor (`diode --version` over PTY, median): 59 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **137 ms** | 98 ms | 157 ms | 244 ms | 6 ms | 283 MB | 11 |
| `medium` | 126.7 KB | 2000 | **138 ms** | 99 ms | 158 ms | 242 ms | 5 ms | 297 MB | 11 |
| `large` | 1.3 MB | 20000 | **155 ms** | 116 ms | 175 ms | 269 ms | 13 ms | 307 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **225 ms** | 186 ms | 245 ms | 318 ms | 19 ms | 366 MB | 5 |
| `log500m` | 497 MB | 5295839 | **152 ms** | 113 ms | 172 ms | — (plaintext) | 10 ms | 307 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 12 ms | 10 ms | 5 ms |
| node ready (bootstrapComplete) | 65 ms | 66 ms | 76 ms | 80 ms | 63 ms |
| bundle executed (main:start) | 65 ms | 66 ms | 76 ms | 81 ms | 63 ms |
| config loaded | 82 ms | 81 ms | 92 ms | 102 ms | 77 ms |
| keybindings loaded | 84 ms | 83 ms | 92 ms | 102 ms | 77 ms |
| session state loaded | 84 ms | 83 ms | 92 ms | 102 ms | 77 ms |
| extensions scanned | 78 ms | 77 ms | 89 ms | 94 ms | 74 ms |
| themes ready | 87 ms | 86 ms | 97 ms | 105 ms | 82 ms |
| DI container created | 89 ms | 89 ms | 100 ms | 107 ms | 85 ms |
| workbench mounted | 121 ms | 122 ms | 133 ms | 139 ms | 122 ms |
| first frame | 121 ms | 122 ms | 133 ms | 139 ms | 122 ms |
| workbench activated | 133 ms | 131 ms | 139 ms | 145 ms | 134 ms |
| grammars preloaded | 137 ms | 135 ms | 143 ms | 149 ms | 136 ms |
| file read from disk | 139 ms | 138 ms | 152 ms | 221 ms | 143 ms |
| file decoded | 139 ms | 138 ms | 152 ms | 222 ms | 143 ms |
| document built | 139 ms | 138 ms | 152 ms | 222 ms | 143 ms |
| tokenizer attached to editor | 156 ms | 158 ms | 174 ms | 245 ms | — |
| tabs opened | 142 ms | 143 ms | 160 ms | 230 ms | 160 ms |
| built-in extensions registered | 268 ms | 267 ms | 292 ms | 340 ms | 210 ms |
| frame with file text | 156 ms | 156 ms | 173 ms | 243 ms | 172 ms |
| frame with highlighting | 244 ms | 242 ms | 269 ms | 318 ms | — |
| extension host up | 460 ms | 497 ms | 569 ms | 941 ms | 363 ms |
| startup complete | 261 ms | 258 ms | 284 ms | 333 ms | 202 ms |
| to text (black box) | 157 ms | 158 ms | 175 ms | 245 ms | 172 ms |
| to highlight (black box) | 244 ms | 242 ms | 269 ms | 318 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 2 ms | 1 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 27 ms | 15 ms | 9 ms | 7 ms | — | 5 ms | 3 ms |
| `medium` failed | 27 ms | 13 ms | 9 ms | 9 ms | — | 5 ms | 4 ms |
| `large` failed | 26 ms | 28 ms | 20 ms | 15 ms | — | 14 ms | 14 ms |
| `xlarge` failed | 43 ms | 38 ms | 23 ms | 25 ms | — | 20 ms | 60 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
