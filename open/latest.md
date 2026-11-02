# File open benchmark

- Recorded: 2026-11-02T11:11:55.202Z, commit `5f550a923b04`, diode nightly-5f550a9
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 64 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **150 ms** | 111 ms | 175 ms | 297 ms | 9 ms | 257 MB | 11 |
| `medium` | 126.7 KB | 2000 | **154 ms** | 115 ms | 179 ms | 301 ms | 6 ms | 281 MB | 11 |
| `large` | 1.3 MB | 20000 | **171 ms** | 131 ms | 195 ms | 329 ms | 6 ms | 294 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **262 ms** | 222 ms | 287 ms | 419 ms | 42 ms | 370 MB | 5 |
| `log500m` | 497 MB | 5295839 | **160 ms** | 121 ms | 185 ms | — (plaintext) | 2 ms | 302 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 6 ms | 8 ms | 8 ms | 6 ms |
| node ready (bootstrapComplete) | 69 ms | 71 ms | 74 ms | 89 ms | 65 ms |
| bundle executed (main:start) | 69 ms | 71 ms | 74 ms | 89 ms | 65 ms |
| config loaded | 91 ms | 92 ms | 97 ms | 113 ms | 86 ms |
| keybindings loaded | 91 ms | 94 ms | 97 ms | 113 ms | 89 ms |
| session state loaded | 91 ms | 95 ms | 97 ms | 114 ms | 89 ms |
| extensions scanned | 87 ms | 88 ms | 90 ms | 108 ms | 82 ms |
| themes ready | 95 ms | 98 ms | 100 ms | 118 ms | 94 ms |
| DI container created | 101 ms | 101 ms | 104 ms | 123 ms | 98 ms |
| workbench mounted | 135 ms | 136 ms | 140 ms | 156 ms | 130 ms |
| first frame | 135 ms | 136 ms | 140 ms | 156 ms | 130 ms |
| workbench activated | 145 ms | 143 ms | 146 ms | 162 ms | 135 ms |
| grammars preloaded | 150 ms | 149 ms | 152 ms | 167 ms | 138 ms |
| file read from disk | 153 ms | 154 ms | 166 ms | 263 ms | 151 ms |
| file decoded | 153 ms | 154 ms | 166 ms | 263 ms | 151 ms |
| document built | 153 ms | 154 ms | 166 ms | 263 ms | 151 ms |
| tokenizer attached to editor | 176 ms | 186 ms | 211 ms | 303 ms | — |
| tabs opened | 158 ms | 162 ms | 178 ms | 273 ms | 170 ms |
| built-in extensions registered | 322 ms | 328 ms | 354 ms | 442 ms | 227 ms |
| frame with file text | 173 ms | 178 ms | 193 ms | 286 ms | 185 ms |
| frame with highlighting | 296 ms | 301 ms | 329 ms | 418 ms | — |
| extension host up | 564 ms | 623 ms | 689 ms | 1140 ms | 424 ms |
| startup complete | 316 ms | 321 ms | 347 ms | 436 ms | 218 ms |
| to text (black box) | 175 ms | 179 ms | 195 ms | 287 ms | 185 ms |
| to highlight (black box) | 297 ms | 301 ms | 329 ms | 419 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 2 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 32 ms | 13 ms | 10 ms | 10 ms | 22 ms | 7 ms | 4 ms |
| `medium` | 34 ms | 11 ms | 11 ms | 13 ms | 22 ms | 7 ms | 5 ms |
| `large` | 41 ms | 30 ms | 23 ms | 28 ms | 44 ms | 15 ms | 19 ms |
| `xlarge` | 31 ms | 36 ms | 22 ms | 26 ms | 124 ms | 17 ms | 82 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
