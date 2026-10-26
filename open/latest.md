# File open benchmark

- Recorded: 2026-10-26T13:54:40.297Z, commit `7c1ed3447e44`, diode nightly-7c1ed34
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 28 ms; binary floor (`diode --version` over PTY, median): 67 ms; for reference `node --version`: 5 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **150 ms** | 110 ms | 178 ms | 301 ms | 4 ms | 252 MB | 11 |
| `medium` | 126.7 KB | 2000 | **154 ms** | 115 ms | 182 ms | 301 ms | 12 ms | 278 MB | 11 |
| `large` | 1.3 MB | 20000 | **168 ms** | 129 ms | 196 ms | 319 ms | 7 ms | 296 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **267 ms** | 228 ms | 295 ms | 403 ms | 8 ms | 358 MB | 5 |
| `log500m` | 497 MB | 5295839 | **167 ms** | 128 ms | 195 ms | — (plaintext) | 2 ms | 271 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 8 ms | 7 ms | 8 ms | 10 ms | 6 ms |
| node ready (bootstrapComplete) | 71 ms | 73 ms | 77 ms | 91 ms | 69 ms |
| bundle executed (main:start) | 71 ms | 73 ms | 77 ms | 91 ms | 69 ms |
| config loaded | 91 ms | 92 ms | 94 ms | 107 ms | 88 ms |
| keybindings loaded | 92 ms | 93 ms | 94 ms | 108 ms | 88 ms |
| session state loaded | 92 ms | 93 ms | 94 ms | 108 ms | 89 ms |
| extensions scanned | 87 ms | 87 ms | 90 ms | 104 ms | 84 ms |
| themes ready | 97 ms | 97 ms | 100 ms | 114 ms | 94 ms |
| DI container created | 102 ms | 102 ms | 105 ms | 119 ms | 99 ms |
| workbench mounted | 138 ms | 139 ms | 143 ms | 159 ms | 135 ms |
| first frame | 138 ms | 139 ms | 143 ms | 159 ms | 135 ms |
| workbench activated | 148 ms | 146 ms | 151 ms | 167 ms | 145 ms |
| grammars preloaded | 155 ms | 152 ms | 158 ms | 174 ms | 148 ms |
| file read from disk | 158 ms | 158 ms | 172 ms | 266 ms | 160 ms |
| file decoded | 158 ms | 158 ms | 172 ms | 266 ms | 160 ms |
| document built | 158 ms | 158 ms | 172 ms | 266 ms | 160 ms |
| tokenizer attached to editor | 177 ms | 183 ms | 197 ms | 295 ms | — |
| tabs opened | 162 ms | 165 ms | 180 ms | 277 ms | 181 ms |
| built-in extensions registered | 321 ms | 323 ms | 341 ms | 425 ms | 234 ms |
| frame with file text | 176 ms | 181 ms | 196 ms | 293 ms | 194 ms |
| frame with highlighting | 299 ms | 299 ms | 319 ms | 403 ms | — |
| extension host up | 584 ms | 625 ms | 671 ms | 1004 ms | 458 ms |
| startup complete | 316 ms | 316 ms | 335 ms | 419 ms | 227 ms |
| to text (black box) | 178 ms | 182 ms | 196 ms | 295 ms | 195 ms |
| to highlight (black box) | 301 ms | 301 ms | 319 ms | 403 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 2 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 38 ms | 13 ms | 10 ms | 9 ms | 19 ms | 7 ms | 4 ms |
| `medium` | 38 ms | 14 ms | 11 ms | 11 ms | 16 ms | 7 ms | 5 ms |
| `large` | 33 ms | 18 ms | 21 ms | 17 ms | 44 ms | 16 ms | 15 ms |
| `xlarge` | 31 ms | 19 ms | 9 ms | 10 ms | 96 ms | 7 ms | 78 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
