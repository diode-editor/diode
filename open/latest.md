# File open benchmark

- Recorded: 2026-11-24T17:57:17.422Z, commit `9886c43b4655`, diode nightly-9886c43
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1020-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 24 ms; binary floor (`diode --version` over PTY, median): 72 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **175 ms** | 128 ms | 199 ms | 318 ms | 16 ms | 292 MB | 11 |
| `medium` | 126.7 KB | 2000 | **174 ms** | 126 ms | 198 ms | 312 ms | 12 ms | 301 MB | 11 |
| `large` | 1.3 MB | 20000 | **188 ms** | 140 ms | 212 ms | 327 ms | 11 ms | 312 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **284 ms** | 236 ms | 308 ms | 408 ms | 3 ms | 361 MB | 5 |
| `log500m` | 497 MB | 5295839 | **189 ms** | 141 ms | 213 ms | — (plaintext) | 4 ms | 321 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 7 ms | 7 ms | 11 ms | 6 ms |
| node ready (bootstrapComplete) | 74 ms | 77 ms | 81 ms | 101 ms | 73 ms |
| bundle executed (main:start) | 74 ms | 77 ms | 81 ms | 101 ms | 73 ms |
| config loaded | 97 ms | 99 ms | 105 ms | 124 ms | 93 ms |
| keybindings loaded | 97 ms | 99 ms | 105 ms | 126 ms | 94 ms |
| session state loaded | 97 ms | 100 ms | 105 ms | 127 ms | 94 ms |
| extensions scanned | 90 ms | 92 ms | 98 ms | 117 ms | 89 ms |
| themes ready | 104 ms | 106 ms | 110 ms | 130 ms | 99 ms |
| DI container created | 107 ms | 109 ms | 115 ms | 134 ms | 104 ms |
| workbench mounted | 157 ms | 154 ms | 156 ms | 177 ms | 154 ms |
| first frame | 157 ms | 154 ms | 156 ms | 177 ms | 154 ms |
| workbench activated | 165 ms | 161 ms | 165 ms | 185 ms | 162 ms |
| grammars preloaded | 171 ms | 166 ms | 170 ms | 190 ms | 164 ms |
| file read from disk | 174 ms | 171 ms | 184 ms | 281 ms | 177 ms |
| file decoded | 174 ms | 171 ms | 184 ms | 281 ms | 177 ms |
| document built | 174 ms | 171 ms | 184 ms | 281 ms | 177 ms |
| tokenizer attached to editor | 198 ms | 197 ms | 214 ms | 309 ms | — |
| tabs opened | 179 ms | 179 ms | 193 ms | 291 ms | 195 ms |
| built-in extensions registered | 350 ms | 350 ms | 362 ms | 442 ms | 270 ms |
| frame with file text | 197 ms | 195 ms | 211 ms | 307 ms | 213 ms |
| frame with highlighting | 318 ms | 311 ms | 327 ms | 407 ms | — |
| extension host up | 609 ms | 650 ms | 720 ms | 1167 ms | 456 ms |
| startup complete | 339 ms | 337 ms | 350 ms | 430 ms | 254 ms |
| to text (black box) | 199 ms | 198 ms | 212 ms | 308 ms | 213 ms |
| to highlight (black box) | 318 ms | 312 ms | 327 ms | 408 ms | — |
| gap black − white (text) | 1 ms | 3 ms | 1 ms | 2 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 31 ms | 14 ms | 12 ms | 11 ms | — | 7 ms | 6 ms |
| `medium` failed | 32 ms | 17 ms | 12 ms | 17 ms | — | 9 ms | 12 ms |
| `large` failed | 37 ms | 29 ms | 27 ms | 23 ms | — | 16 ms | 17 ms |
| `xlarge` failed | 31 ms | 36 ms | 22 ms | 32 ms | — | 20 ms | 79 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
