# File open benchmark

- Recorded: 2026-11-19T10:08:35.077Z, commit `a2434929b372`, diode nightly-a243492
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 22 ms; binary floor (`diode --version` over PTY, median): 63 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **141 ms** | 99 ms | 162 ms | 251 ms | 6 ms | 290 MB | 11 |
| `medium` | 126.7 KB | 2000 | **142 ms** | 101 ms | 164 ms | 252 ms | 4 ms | 302 MB | 11 |
| `large` | 1.3 MB | 20000 | **161 ms** | 119 ms | 182 ms | 270 ms | 9 ms | 314 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **227 ms** | 186 ms | 249 ms | 327 ms | 5 ms | 364 MB | 5 |
| `log500m` | 497 MB | 5295839 | **135 ms** | 94 ms | 157 ms | — (plaintext) | 6 ms | 344 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 6 ms | 6 ms | 7 ms | 5 ms |
| node ready (bootstrapComplete) | 68 ms | 66 ms | 72 ms | 87 ms | 60 ms |
| bundle executed (main:start) | 68 ms | 66 ms | 72 ms | 87 ms | 60 ms |
| config loaded | 89 ms | 83 ms | 91 ms | 104 ms | 76 ms |
| keybindings loaded | 89 ms | 86 ms | 91 ms | 104 ms | 78 ms |
| session state loaded | 89 ms | 86 ms | 91 ms | 104 ms | 79 ms |
| extensions scanned | 83 ms | 79 ms | 86 ms | 99 ms | 72 ms |
| themes ready | 92 ms | 89 ms | 95 ms | 108 ms | 81 ms |
| DI container created | 95 ms | 91 ms | 99 ms | 112 ms | 84 ms |
| workbench mounted | 128 ms | 127 ms | 137 ms | 147 ms | 115 ms |
| first frame | 128 ms | 127 ms | 137 ms | 147 ms | 115 ms |
| workbench activated | 139 ms | 135 ms | 143 ms | 159 ms | 120 ms |
| grammars preloaded | 142 ms | 139 ms | 147 ms | 163 ms | 122 ms |
| file read from disk | 145 ms | 142 ms | 160 ms | 226 ms | 130 ms |
| file decoded | 145 ms | 142 ms | 160 ms | 227 ms | 130 ms |
| document built | 145 ms | 143 ms | 160 ms | 227 ms | 130 ms |
| tokenizer attached to editor | 162 ms | 164 ms | 184 ms | 250 ms | — |
| tabs opened | 149 ms | 148 ms | 169 ms | 235 ms | 145 ms |
| built-in extensions registered | 281 ms | 281 ms | 297 ms | 352 ms | 200 ms |
| frame with file text | 162 ms | 162 ms | 182 ms | 248 ms | 157 ms |
| frame with highlighting | 251 ms | 252 ms | 269 ms | 327 ms | — |
| extension host up | 486 ms | 531 ms | 584 ms | 956 ms | 369 ms |
| startup complete | 271 ms | 271 ms | 286 ms | 344 ms | 189 ms |
| to text (black box) | 162 ms | 164 ms | 182 ms | 249 ms | 157 ms |
| to highlight (black box) | 251 ms | 252 ms | 270 ms | 327 ms | — |
| gap black − white (text) | 2 ms | 3 ms | 1 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 27 ms | 12 ms | 9 ms | 9 ms | — | 8 ms | 3 ms |
| `medium` failed | 30 ms | 12 ms | 9 ms | 10 ms | — | 6 ms | 4 ms |
| `large` failed | 25 ms | 22 ms | 20 ms | 16 ms | — | 11 ms | 15 ms |
| `xlarge` failed | 34 ms | 29 ms | 18 ms | 15 ms | — | 14 ms | 68 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
