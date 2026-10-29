# File open benchmark

- Recorded: 2026-10-29T22:59:50.003Z, commit `afe5bdaf1864`, diode nightly-afe5bda
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 62 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **144 ms** | 107 ms | 169 ms | 284 ms | 6 ms | 253 MB | 11 |
| `medium` | 126.7 KB | 2000 | **154 ms** | 116 ms | 178 ms | 298 ms | 9 ms | 280 MB | 11 |
| `large` | 1.3 MB | 20000 | **159 ms** | 121 ms | 183 ms | 321 ms | 8 ms | 292 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **254 ms** | 216 ms | 279 ms | 408 ms | 8 ms | 365 MB | 5 |
| `log500m` | 497 MB | 5295839 | **162 ms** | 124 ms | 186 ms | — (plaintext) | 3 ms | 270 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 7 ms | 9 ms | 6 ms |
| node ready (bootstrapComplete) | 67 ms | 68 ms | 69 ms | 87 ms | 63 ms |
| bundle executed (main:start) | 67 ms | 68 ms | 69 ms | 87 ms | 63 ms |
| config loaded | 85 ms | 87 ms | 90 ms | 108 ms | 83 ms |
| keybindings loaded | 85 ms | 88 ms | 90 ms | 108 ms | 84 ms |
| session state loaded | 86 ms | 88 ms | 90 ms | 108 ms | 84 ms |
| extensions scanned | 81 ms | 84 ms | 84 ms | 101 ms | 80 ms |
| themes ready | 91 ms | 92 ms | 96 ms | 111 ms | 89 ms |
| DI container created | 95 ms | 97 ms | 100 ms | 115 ms | 93 ms |
| workbench mounted | 130 ms | 131 ms | 132 ms | 147 ms | 125 ms |
| first frame | 130 ms | 131 ms | 132 ms | 147 ms | 125 ms |
| workbench activated | 137 ms | 139 ms | 137 ms | 154 ms | 134 ms |
| grammars preloaded | 145 ms | 147 ms | 142 ms | 159 ms | 138 ms |
| file read from disk | 148 ms | 151 ms | 156 ms | 250 ms | 150 ms |
| file decoded | 148 ms | 151 ms | 156 ms | 250 ms | 150 ms |
| document built | 148 ms | 152 ms | 156 ms | 251 ms | 150 ms |
| tokenizer attached to editor | 170 ms | 182 ms | 198 ms | 293 ms | — |
| tabs opened | 152 ms | 159 ms | 166 ms | 259 ms | 171 ms |
| built-in extensions registered | 310 ms | 325 ms | 345 ms | 432 ms | 229 ms |
| frame with file text | 168 ms | 175 ms | 181 ms | 277 ms | 186 ms |
| frame with highlighting | 282 ms | 298 ms | 321 ms | 408 ms | — |
| extension host up | 556 ms | 591 ms | 660 ms | 1100 ms | 416 ms |
| startup complete | 303 ms | 318 ms | 338 ms | 426 ms | 221 ms |
| to text (black box) | 169 ms | 178 ms | 183 ms | 279 ms | 186 ms |
| to highlight (black box) | 284 ms | 298 ms | 321 ms | 408 ms | — |
| gap black − white (text) | 2 ms | 3 ms | 2 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 30 ms | 14 ms | 9 ms | 10 ms | 21 ms | 10 ms | 4 ms |
| `medium` | 34 ms | 14 ms | 14 ms | 10 ms | 18 ms | 7 ms | 5 ms |
| `large` | 38 ms | 20 ms | 17 ms | 24 ms | 46 ms | 14 ms | 14 ms |
| `xlarge` | 27 ms | 17 ms | 9 ms | 12 ms | 100 ms | 8 ms | 81 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
