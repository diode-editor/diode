# File open benchmark

- Recorded: 2026-11-15T19:04:22.491Z, commit `fa3a144e74fd`, diode nightly-fa3a144
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 24 ms; binary floor (`diode --version` over PTY, median): 69 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **168 ms** | 123 ms | 192 ms | 305 ms | 14 ms | 281 MB | 11 |
| `medium` | 126.7 KB | 2000 | **166 ms** | 121 ms | 190 ms | 304 ms | 8 ms | 290 MB | 11 |
| `large` | 1.3 MB | 20000 | **183 ms** | 138 ms | 207 ms | 328 ms | 7 ms | 300 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **270 ms** | 226 ms | 295 ms | 402 ms | 17 ms | 357 MB | 5 |
| `log500m` | 497 MB | 5295839 | **182 ms** | 137 ms | 206 ms | — (plaintext) | 1 ms | 308 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 8 ms | 9 ms | 6 ms |
| node ready (bootstrapComplete) | 74 ms | 75 ms | 77 ms | 90 ms | 72 ms |
| bundle executed (main:start) | 74 ms | 75 ms | 77 ms | 90 ms | 72 ms |
| config loaded | 94 ms | 95 ms | 100 ms | 112 ms | 95 ms |
| keybindings loaded | 95 ms | 96 ms | 101 ms | 112 ms | 95 ms |
| session state loaded | 95 ms | 96 ms | 101 ms | 112 ms | 95 ms |
| extensions scanned | 90 ms | 89 ms | 93 ms | 108 ms | 91 ms |
| themes ready | 99 ms | 102 ms | 105 ms | 118 ms | 101 ms |
| DI container created | 103 ms | 107 ms | 108 ms | 122 ms | 105 ms |
| workbench mounted | 151 ms | 145 ms | 153 ms | 170 ms | 142 ms |
| first frame | 151 ms | 145 ms | 153 ms | 170 ms | 142 ms |
| workbench activated | 158 ms | 153 ms | 161 ms | 178 ms | 150 ms |
| grammars preloaded | 164 ms | 158 ms | 165 ms | 185 ms | 152 ms |
| file read from disk | 167 ms | 162 ms | 177 ms | 269 ms | 166 ms |
| file decoded | 167 ms | 162 ms | 177 ms | 269 ms | 166 ms |
| document built | 167 ms | 162 ms | 178 ms | 270 ms | 166 ms |
| tokenizer attached to editor | 192 ms | 189 ms | 208 ms | 296 ms | — |
| tabs opened | 173 ms | 168 ms | 190 ms | 281 ms | 188 ms |
| built-in extensions registered | 337 ms | 334 ms | 355 ms | 433 ms | 257 ms |
| frame with file text | 191 ms | 187 ms | 206 ms | 294 ms | 206 ms |
| frame with highlighting | 305 ms | 302 ms | 328 ms | 402 ms | — |
| extension host up | 591 ms | 632 ms | 711 ms | 1158 ms | 463 ms |
| startup complete | 327 ms | 325 ms | 347 ms | 422 ms | 245 ms |
| to text (black box) | 192 ms | 190 ms | 207 ms | 295 ms | 206 ms |
| to highlight (black box) | 305 ms | 304 ms | 328 ms | 402 ms | — |
| gap black − white (text) | 0 ms | 1 ms | 0 ms | 2 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 45 ms | 15 ms | 11 ms | 9 ms | — | 6 ms | 4 ms |
| `medium` failed | 34 ms | 14 ms | 11 ms | 11 ms | — | 10 ms | 5 ms |
| `large` failed | 33 ms | 22 ms | 25 ms | 25 ms | — | 19 ms | 25 ms |
| `xlarge` failed | 32 ms | 41 ms | 28 ms | 55 ms | — | 26 ms | 75 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
