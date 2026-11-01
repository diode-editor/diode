# File open benchmark

- Recorded: 2026-11-01T08:06:47.171Z, commit `babfedcb1c24`, diode nightly-babfedc
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 63 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **143 ms** | 104 ms | 168 ms | 285 ms | 11 ms | 263 MB | 11 |
| `medium` | 126.7 KB | 2000 | **154 ms** | 115 ms | 178 ms | 298 ms | 8 ms | 282 MB | 11 |
| `large` | 1.3 MB | 20000 | **167 ms** | 129 ms | 192 ms | 324 ms | 14 ms | 300 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **252 ms** | 214 ms | 277 ms | 403 ms | 7 ms | 367 MB | 5 |
| `log500m` | 497 MB | 5295839 | **165 ms** | 127 ms | 190 ms | — (plaintext) | 2 ms | 271 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 8 ms | 9 ms | 6 ms |
| node ready (bootstrapComplete) | 67 ms | 68 ms | 75 ms | 85 ms | 64 ms |
| bundle executed (main:start) | 67 ms | 68 ms | 75 ms | 85 ms | 64 ms |
| config loaded | 88 ms | 87 ms | 92 ms | 105 ms | 80 ms |
| keybindings loaded | 89 ms | 87 ms | 92 ms | 105 ms | 80 ms |
| session state loaded | 89 ms | 87 ms | 92 ms | 105 ms | 80 ms |
| extensions scanned | 84 ms | 83 ms | 89 ms | 98 ms | 77 ms |
| themes ready | 94 ms | 93 ms | 97 ms | 108 ms | 85 ms |
| DI container created | 98 ms | 97 ms | 102 ms | 111 ms | 90 ms |
| workbench mounted | 128 ms | 132 ms | 137 ms | 147 ms | 126 ms |
| first frame | 128 ms | 132 ms | 137 ms | 147 ms | 126 ms |
| workbench activated | 137 ms | 142 ms | 146 ms | 157 ms | 137 ms |
| grammars preloaded | 142 ms | 148 ms | 153 ms | 162 ms | 139 ms |
| file read from disk | 144 ms | 153 ms | 165 ms | 252 ms | 154 ms |
| file decoded | 145 ms | 153 ms | 165 ms | 252 ms | 154 ms |
| document built | 145 ms | 153 ms | 165 ms | 252 ms | 154 ms |
| tokenizer attached to editor | 169 ms | 184 ms | 205 ms | 293 ms | — |
| tabs opened | 149 ms | 159 ms | 174 ms | 262 ms | 174 ms |
| built-in extensions registered | 311 ms | 326 ms | 346 ms | 427 ms | 238 ms |
| frame with file text | 167 ms | 175 ms | 188 ms | 277 ms | 190 ms |
| frame with highlighting | 284 ms | 298 ms | 323 ms | 403 ms | — |
| extension host up | 557 ms | 601 ms | 652 ms | 1096 ms | 426 ms |
| startup complete | 305 ms | 319 ms | 340 ms | 421 ms | 230 ms |
| to text (black box) | 168 ms | 178 ms | 192 ms | 277 ms | 190 ms |
| to highlight (black box) | 285 ms | 298 ms | 324 ms | 403 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 2 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 42 ms | 16 ms | 11 ms | 10 ms | 21 ms | 7 ms | 4 ms |
| `medium` | 37 ms | 13 ms | 14 ms | 10 ms | 21 ms | 7 ms | 5 ms |
| `large` | 31 ms | 26 ms | 22 ms | 26 ms | 51 ms | 16 ms | 16 ms |
| `xlarge` | 29 ms | 26 ms | 13 ms | 15 ms | 136 ms | 14 ms | 74 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
