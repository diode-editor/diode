# File open benchmark

- Recorded: 2026-11-05T00:29:14.774Z, commit `e97b481ee548`, diode nightly-e97b481
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 63 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **145 ms** | 106 ms | 170 ms | 282 ms | 5 ms | 270 MB | 11 |
| `medium` | 126.7 KB | 2000 | **148 ms** | 110 ms | 173 ms | 293 ms | 13 ms | 281 MB | 11 |
| `large` | 1.3 MB | 20000 | **164 ms** | 125 ms | 188 ms | 307 ms | 14 ms | 293 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **274 ms** | 235 ms | 298 ms | 403 ms | 30 ms | 346 MB | 5 |
| `log500m` | 497 MB | 5295839 | **166 ms** | 128 ms | 191 ms | — (plaintext) | 4 ms | 274 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 7 ms | 12 ms | 6 ms |
| node ready (bootstrapComplete) | 68 ms | 72 ms | 71 ms | 88 ms | 67 ms |
| bundle executed (main:start) | 68 ms | 72 ms | 71 ms | 88 ms | 67 ms |
| config loaded | 86 ms | 91 ms | 93 ms | 112 ms | 89 ms |
| keybindings loaded | 87 ms | 92 ms | 95 ms | 112 ms | 89 ms |
| session state loaded | 87 ms | 93 ms | 95 ms | 113 ms | 89 ms |
| extensions scanned | 82 ms | 85 ms | 90 ms | 104 ms | 84 ms |
| themes ready | 92 ms | 96 ms | 98 ms | 116 ms | 94 ms |
| DI container created | 97 ms | 100 ms | 102 ms | 120 ms | 99 ms |
| workbench mounted | 131 ms | 132 ms | 137 ms | 154 ms | 133 ms |
| first frame | 131 ms | 132 ms | 137 ms | 153 ms | 133 ms |
| workbench activated | 139 ms | 136 ms | 143 ms | 164 ms | 141 ms |
| grammars preloaded | 146 ms | 144 ms | 148 ms | 169 ms | 143 ms |
| file read from disk | 149 ms | 147 ms | 162 ms | 273 ms | 155 ms |
| file decoded | 149 ms | 147 ms | 162 ms | 273 ms | 155 ms |
| document built | 149 ms | 148 ms | 162 ms | 273 ms | 155 ms |
| tokenizer attached to editor | 169 ms | 172 ms | 190 ms | 300 ms | — |
| tabs opened | 153 ms | 155 ms | 171 ms | 283 ms | 176 ms |
| built-in extensions registered | 309 ms | 318 ms | 333 ms | 430 ms | 237 ms |
| frame with file text | 168 ms | 170 ms | 188 ms | 298 ms | 191 ms |
| frame with highlighting | 282 ms | 293 ms | 307 ms | 403 ms | — |
| extension host up | 569 ms | 619 ms | 702 ms | 1159 ms | 439 ms |
| startup complete | 300 ms | 310 ms | 324 ms | 421 ms | 227 ms |
| to text (black box) | 170 ms | 173 ms | 188 ms | 298 ms | 191 ms |
| to highlight (black box) | 282 ms | 293 ms | 307 ms | 403 ms | — |
| gap black − white (text) | 0 ms | 1 ms | 2 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 36 ms | 13 ms | 13 ms | 13 ms | — | 9 ms | 5 ms |
| `medium` failed | 32 ms | 16 ms | 12 ms | 14 ms | — | 6 ms | 8 ms |
| `large` failed | 46 ms | 23 ms | 24 ms | 25 ms | — | 17 ms | 21 ms |
| `xlarge` failed | 29 ms | 39 ms | 27 ms | 45 ms | — | 26 ms | 79 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
