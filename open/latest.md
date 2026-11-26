# File open benchmark

- Recorded: 2026-11-26T13:20:31.971Z, commit `8e32a8077a92`, diode nightly-8e32a80
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1020-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 24 ms; binary floor (`diode --version` over PTY, median): 73 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **175 ms** | 126 ms | 199 ms | 316 ms | 15 ms | 299 MB | 11 |
| `medium` | 126.7 KB | 2000 | **179 ms** | 130 ms | 203 ms | 323 ms | 5 ms | 303 MB | 11 |
| `large` | 1.3 MB | 20000 | **204 ms** | 156 ms | 229 ms | 344 ms | 13 ms | 314 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **283 ms** | 235 ms | 308 ms | 412 ms | 20 ms | 363 MB | 5 |
| `log500m` | 497 MB | 5295839 | **201 ms** | 152 ms | 225 ms | — (plaintext) | 6 ms | 325 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 8 ms | 9 ms | 6 ms |
| node ready (bootstrapComplete) | 80 ms | 79 ms | 85 ms | 96 ms | 75 ms |
| bundle executed (main:start) | 80 ms | 79 ms | 85 ms | 96 ms | 75 ms |
| config loaded | 103 ms | 104 ms | 106 ms | 118 ms | 100 ms |
| keybindings loaded | 104 ms | 105 ms | 109 ms | 118 ms | 100 ms |
| session state loaded | 104 ms | 105 ms | 109 ms | 118 ms | 100 ms |
| extensions scanned | 96 ms | 97 ms | 101 ms | 109 ms | 96 ms |
| themes ready | 108 ms | 111 ms | 114 ms | 123 ms | 105 ms |
| DI container created | 112 ms | 114 ms | 117 ms | 126 ms | 109 ms |
| workbench mounted | 159 ms | 159 ms | 170 ms | 176 ms | 157 ms |
| first frame | 159 ms | 159 ms | 170 ms | 176 ms | 157 ms |
| workbench activated | 167 ms | 168 ms | 178 ms | 185 ms | 166 ms |
| grammars preloaded | 172 ms | 174 ms | 184 ms | 190 ms | 168 ms |
| file read from disk | 175 ms | 177 ms | 197 ms | 281 ms | 183 ms |
| file decoded | 175 ms | 177 ms | 197 ms | 281 ms | 183 ms |
| document built | 175 ms | 177 ms | 197 ms | 281 ms | 183 ms |
| tokenizer attached to editor | 198 ms | 202 ms | 228 ms | 309 ms | — |
| tabs opened | 181 ms | 184 ms | 207 ms | 290 ms | 206 ms |
| built-in extensions registered | 350 ms | 357 ms | 378 ms | 446 ms | 282 ms |
| frame with file text | 197 ms | 200 ms | 226 ms | 307 ms | 224 ms |
| frame with highlighting | 316 ms | 323 ms | 343 ms | 412 ms | — |
| extension host up | 609 ms | 669 ms | 732 ms | 1182 ms | 479 ms |
| startup complete | 338 ms | 345 ms | 365 ms | 434 ms | 268 ms |
| to text (black box) | 199 ms | 203 ms | 229 ms | 308 ms | 225 ms |
| to highlight (black box) | 316 ms | 323 ms | 344 ms | 412 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 1 ms | 0 ms | 2 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 38 ms | 15 ms | 13 ms | 13 ms | — | 10 ms | 4 ms |
| `medium` failed | 33 ms | 18 ms | 12 ms | 14 ms | — | 8 ms | 6 ms |
| `large` failed | 35 ms | 23 ms | 27 ms | 25 ms | — | 18 ms | 16 ms |
| `xlarge` failed | 29 ms | 36 ms | 15 ms | 23 ms | — | 16 ms | 94 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
