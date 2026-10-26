# File open benchmark

- Recorded: 2026-10-26T23:44:18.532Z, commit `c9d24572d42f`, diode nightly-c9d2457
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 26 ms; binary floor (`diode --version` over PTY, median): 63 ms; for reference `node --version`: 5 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **141 ms** | 103 ms | 167 ms | 284 ms | 12 ms | 252 MB | 11 |
| `medium` | 126.7 KB | 2000 | **140 ms** | 103 ms | 166 ms | 281 ms | 10 ms | 277 MB | 11 |
| `large` | 1.3 MB | 20000 | **160 ms** | 123 ms | 186 ms | 304 ms | 6 ms | 295 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **245 ms** | 208 ms | 271 ms | 371 ms | 10 ms | 361 MB | 5 |
| `log500m` | 497 MB | 5295839 | **161 ms** | 124 ms | 187 ms | — (plaintext) | 2 ms | 270 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 7 ms | 7 ms | 8 ms | 6 ms |
| node ready (bootstrapComplete) | 68 ms | 66 ms | 66 ms | 76 ms | 64 ms |
| bundle executed (main:start) | 68 ms | 66 ms | 66 ms | 76 ms | 64 ms |
| config loaded | 86 ms | 88 ms | 86 ms | 95 ms | 85 ms |
| keybindings loaded | 86 ms | 89 ms | 86 ms | 95 ms | 85 ms |
| session state loaded | 86 ms | 89 ms | 86 ms | 95 ms | 85 ms |
| extensions scanned | 83 ms | 82 ms | 82 ms | 89 ms | 81 ms |
| themes ready | 92 ms | 92 ms | 91 ms | 98 ms | 90 ms |
| DI container created | 96 ms | 96 ms | 96 ms | 102 ms | 94 ms |
| workbench mounted | 129 ms | 128 ms | 130 ms | 136 ms | 129 ms |
| first frame | 129 ms | 128 ms | 129 ms | 136 ms | 129 ms |
| workbench activated | 137 ms | 133 ms | 140 ms | 142 ms | 136 ms |
| grammars preloaded | 144 ms | 138 ms | 146 ms | 153 ms | 142 ms |
| file read from disk | 146 ms | 142 ms | 162 ms | 248 ms | 155 ms |
| file decoded | 146 ms | 142 ms | 162 ms | 248 ms | 155 ms |
| document built | 146 ms | 143 ms | 162 ms | 249 ms | 155 ms |
| tokenizer attached to editor | 165 ms | 167 ms | 188 ms | 272 ms | — |
| tabs opened | 150 ms | 149 ms | 172 ms | 259 ms | 174 ms |
| built-in extensions registered | 308 ms | 303 ms | 325 ms | 391 ms | 226 ms |
| frame with file text | 165 ms | 165 ms | 186 ms | 271 ms | 187 ms |
| frame with highlighting | 284 ms | 281 ms | 304 ms | 371 ms | — |
| extension host up | 554 ms | 585 ms | 657 ms | 960 ms | 423 ms |
| startup complete | 302 ms | 297 ms | 319 ms | 386 ms | 219 ms |
| to text (black box) | 167 ms | 166 ms | 186 ms | 271 ms | 187 ms |
| to highlight (black box) | 284 ms | 281 ms | 304 ms | 371 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 2 ms | 0 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 37 ms | 12 ms | 11 ms | 11 ms | 21 ms | 7 ms | 3 ms |
| `medium` | 33 ms | 11 ms | 11 ms | 9 ms | 19 ms | 5 ms | 4 ms |
| `large` | 36 ms | 19 ms | 17 ms | 19 ms | 42 ms | 17 ms | 16 ms |
| `xlarge` | 30 ms | 19 ms | 13 ms | 11 ms | 101 ms | 11 ms | 79 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
