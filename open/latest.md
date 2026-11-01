# File open benchmark

- Recorded: 2026-11-01T19:51:46.546Z, commit `3c0abbed374d`, diode nightly-3c0abbe
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 65 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **147 ms** | 107 ms | 172 ms | 290 ms | 10 ms | 273 MB | 11 |
| `medium` | 126.7 KB | 2000 | **153 ms** | 113 ms | 178 ms | 295 ms | 8 ms | 284 MB | 11 |
| `large` | 1.3 MB | 20000 | **162 ms** | 123 ms | 187 ms | 321 ms | 6 ms | 293 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **258 ms** | 218 ms | 283 ms | 416 ms | 23 ms | 368 MB | 5 |
| `log500m` | 497 MB | 5295839 | **157 ms** | 117 ms | 182 ms | — (plaintext) | 9 ms | 305 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 6 ms | 7 ms | 10 ms | 6 ms |
| node ready (bootstrapComplete) | 70 ms | 69 ms | 69 ms | 92 ms | 66 ms |
| bundle executed (main:start) | 70 ms | 69 ms | 69 ms | 92 ms | 66 ms |
| config loaded | 91 ms | 88 ms | 88 ms | 110 ms | 87 ms |
| keybindings loaded | 91 ms | 89 ms | 89 ms | 111 ms | 90 ms |
| session state loaded | 91 ms | 89 ms | 89 ms | 111 ms | 90 ms |
| extensions scanned | 85 ms | 83 ms | 84 ms | 107 ms | 83 ms |
| themes ready | 95 ms | 92 ms | 94 ms | 116 ms | 93 ms |
| DI container created | 98 ms | 97 ms | 98 ms | 120 ms | 97 ms |
| workbench mounted | 131 ms | 135 ms | 133 ms | 154 ms | 128 ms |
| first frame | 131 ms | 135 ms | 133 ms | 154 ms | 128 ms |
| workbench activated | 140 ms | 141 ms | 143 ms | 159 ms | 134 ms |
| grammars preloaded | 146 ms | 146 ms | 148 ms | 165 ms | 136 ms |
| file read from disk | 149 ms | 150 ms | 161 ms | 257 ms | 149 ms |
| file decoded | 149 ms | 150 ms | 161 ms | 257 ms | 149 ms |
| document built | 149 ms | 151 ms | 161 ms | 258 ms | 149 ms |
| tokenizer attached to editor | 173 ms | 182 ms | 203 ms | 300 ms | — |
| tabs opened | 155 ms | 157 ms | 171 ms | 269 ms | 169 ms |
| built-in extensions registered | 316 ms | 321 ms | 344 ms | 439 ms | 227 ms |
| frame with file text | 171 ms | 175 ms | 186 ms | 283 ms | 182 ms |
| frame with highlighting | 289 ms | 295 ms | 321 ms | 416 ms | — |
| extension host up | 568 ms | 598 ms | 660 ms | 1111 ms | 420 ms |
| startup complete | 310 ms | 314 ms | 338 ms | 433 ms | 220 ms |
| to text (black box) | 172 ms | 178 ms | 187 ms | 283 ms | 182 ms |
| to highlight (black box) | 290 ms | 295 ms | 321 ms | 416 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 2 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 34 ms | 12 ms | 14 ms | 13 ms | 26 ms | 8 ms | 4 ms |
| `medium` | 34 ms | 15 ms | 15 ms | 12 ms | 20 ms | 6 ms | 5 ms |
| `large` | 42 ms | 26 ms | 20 ms | 18 ms | 48 ms | 14 ms | 17 ms |
| `xlarge` | 32 ms | 37 ms | 20 ms | 25 ms | 143 ms | 13 ms | 74 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
