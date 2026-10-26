# File open benchmark

- Recorded: 2026-10-26T08:42:06.798Z, commit `011500a161b8`, diode nightly-011500a
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 26 ms; binary floor (`diode --version` over PTY, median): 67 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **143 ms** | 103 ms | 169 ms | 278 ms | 7 ms | 254 MB | 11 |
| `medium` | 126.7 KB | 2000 | **141 ms** | 101 ms | 167 ms | 277 ms | 8 ms | 279 MB | 11 |
| `large` | 1.3 MB | 20000 | **158 ms** | 117 ms | 184 ms | 292 ms | 9 ms | 291 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **237 ms** | 196 ms | 263 ms | 363 ms | 20 ms | 357 MB | 5 |
| `log500m` | 497 MB | 5295839 | **146 ms** | 106 ms | 172 ms | — (plaintext) | 1 ms | 303 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 8 ms | 7 ms | 8 ms | 6 ms |
| node ready (bootstrapComplete) | 74 ms | 74 ms | 75 ms | 90 ms | 65 ms |
| bundle executed (main:start) | 74 ms | 74 ms | 75 ms | 90 ms | 65 ms |
| config loaded | 91 ms | 91 ms | 92 ms | 105 ms | 87 ms |
| keybindings loaded | 92 ms | 94 ms | 94 ms | 106 ms | 87 ms |
| session state loaded | 92 ms | 94 ms | 94 ms | 106 ms | 87 ms |
| extensions scanned | 88 ms | 87 ms | 89 ms | 103 ms | 84 ms |
| themes ready | 96 ms | 99 ms | 98 ms | 111 ms | 90 ms |
| DI container created | 100 ms | 103 ms | 102 ms | 115 ms | 94 ms |
| workbench mounted | 132 ms | 131 ms | 134 ms | 147 ms | 120 ms |
| first frame | 132 ms | 131 ms | 134 ms | 147 ms | 120 ms |
| workbench activated | 138 ms | 136 ms | 139 ms | 153 ms | 124 ms |
| grammars preloaded | 148 ms | 141 ms | 150 ms | 160 ms | 126 ms |
| file read from disk | 150 ms | 145 ms | 161 ms | 240 ms | 138 ms |
| file decoded | 150 ms | 145 ms | 161 ms | 240 ms | 138 ms |
| document built | 150 ms | 145 ms | 162 ms | 240 ms | 138 ms |
| tokenizer attached to editor | 168 ms | 167 ms | 184 ms | 265 ms | — |
| tabs opened | 153 ms | 151 ms | 169 ms | 249 ms | 158 ms |
| built-in extensions registered | 301 ms | 300 ms | 312 ms | 382 ms | 210 ms |
| frame with file text | 168 ms | 165 ms | 183 ms | 263 ms | 171 ms |
| frame with highlighting | 278 ms | 277 ms | 291 ms | 362 ms | — |
| extension host up | 551 ms | 567 ms | 624 ms | 948 ms | 400 ms |
| startup complete | 294 ms | 293 ms | 306 ms | 376 ms | 202 ms |
| to text (black box) | 169 ms | 167 ms | 184 ms | 263 ms | 172 ms |
| to highlight (black box) | 278 ms | 277 ms | 292 ms | 363 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 35 ms | 14 ms | 12 ms | 9 ms | 15 ms | 11 ms | 4 ms |
| `medium` | 31 ms | 11 ms | 11 ms | 8 ms | 14 ms | 6 ms | 4 ms |
| `large` | 37 ms | 18 ms | 17 ms | 22 ms | 47 ms | 15 ms | 16 ms |
| `xlarge` | 32 ms | 21 ms | 12 ms | 13 ms | 110 ms | 9 ms | 75 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
