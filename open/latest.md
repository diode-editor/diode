# File open benchmark

- Recorded: 2026-11-01T04:16:14.109Z, commit `daaf264ffdb6`, diode nightly-daaf264
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 29 ms; binary floor (`diode --version` over PTY, median): 64 ms; for reference `node --version`: 5 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **141 ms** | 106 ms | 169 ms | 284 ms | 6 ms | 255 MB | 11 |
| `medium` | 126.7 KB | 2000 | **146 ms** | 111 ms | 175 ms | 301 ms | 7 ms | 283 MB | 11 |
| `large` | 1.3 MB | 20000 | **158 ms** | 123 ms | 187 ms | 320 ms | 6 ms | 296 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **249 ms** | 214 ms | 278 ms | 405 ms | 7 ms | 365 MB | 5 |
| `log500m` | 497 MB | 5295839 | **159 ms** | 125 ms | 188 ms | — (plaintext) | 9 ms | 292 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 7 ms | 9 ms | 6 ms |
| node ready (bootstrapComplete) | 68 ms | 69 ms | 69 ms | 84 ms | 65 ms |
| bundle executed (main:start) | 68 ms | 69 ms | 69 ms | 84 ms | 66 ms |
| config loaded | 85 ms | 88 ms | 89 ms | 106 ms | 88 ms |
| keybindings loaded | 86 ms | 89 ms | 89 ms | 106 ms | 88 ms |
| session state loaded | 86 ms | 89 ms | 89 ms | 106 ms | 88 ms |
| extensions scanned | 81 ms | 84 ms | 83 ms | 101 ms | 85 ms |
| themes ready | 91 ms | 93 ms | 94 ms | 111 ms | 91 ms |
| DI container created | 96 ms | 98 ms | 97 ms | 116 ms | 95 ms |
| workbench mounted | 130 ms | 132 ms | 133 ms | 147 ms | 128 ms |
| first frame | 130 ms | 132 ms | 133 ms | 147 ms | 128 ms |
| workbench activated | 140 ms | 143 ms | 138 ms | 154 ms | 133 ms |
| grammars preloaded | 146 ms | 148 ms | 144 ms | 159 ms | 136 ms |
| file read from disk | 149 ms | 152 ms | 159 ms | 252 ms | 149 ms |
| file decoded | 149 ms | 152 ms | 159 ms | 252 ms | 150 ms |
| document built | 150 ms | 152 ms | 160 ms | 252 ms | 150 ms |
| tokenizer attached to editor | 171 ms | 179 ms | 202 ms | 295 ms | — |
| tabs opened | 154 ms | 158 ms | 170 ms | 265 ms | 172 ms |
| built-in extensions registered | 311 ms | 327 ms | 345 ms | 429 ms | 228 ms |
| frame with file text | 169 ms | 172 ms | 185 ms | 278 ms | 186 ms |
| frame with highlighting | 284 ms | 300 ms | 320 ms | 405 ms | — |
| extension host up | 555 ms | 610 ms | 665 ms | 1094 ms | 423 ms |
| startup complete | 305 ms | 320 ms | 338 ms | 423 ms | 221 ms |
| to text (black box) | 169 ms | 175 ms | 187 ms | 278 ms | 188 ms |
| to highlight (black box) | 284 ms | 301 ms | 320 ms | 405 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 1 ms | 0 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 34 ms | 13 ms | 11 ms | 12 ms | 22 ms | 8 ms | 3 ms |
| `medium` | 36 ms | 13 ms | 12 ms | 11 ms | 28 ms | 7 ms | 5 ms |
| `large` | 36 ms | 26 ms | 19 ms | 18 ms | 41 ms | 15 ms | 15 ms |
| `xlarge` | 30 ms | 22 ms | 11 ms | 15 ms | 102 ms | 9 ms | 80 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
