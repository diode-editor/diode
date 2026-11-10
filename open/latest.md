# File open benchmark

- Recorded: 2026-11-10T00:07:47.196Z, commit `66895cbdb359`, diode nightly-66895cb
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 22 ms; binary floor (`diode --version` over PTY, median): 58 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **133 ms** | 97 ms | 155 ms | 248 ms | 6 ms | 265 MB | 11 |
| `medium` | 126.7 KB | 2000 | **139 ms** | 103 ms | 160 ms | 250 ms | 16 ms | 289 MB | 11 |
| `large` | 1.3 MB | 20000 | **156 ms** | 120 ms | 178 ms | 268 ms | 5 ms | 300 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **210 ms** | 174 ms | 231 ms | 309 ms | 5 ms | 353 MB | 5 |
| `log500m` | 497 MB | 5295839 | **141 ms** | 105 ms | 163 ms | — (plaintext) | 5 ms | 308 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 7 ms | 7 ms | 7 ms | 5 ms |
| node ready (bootstrapComplete) | 62 ms | 64 ms | 68 ms | 77 ms | 59 ms |
| bundle executed (main:start) | 62 ms | 64 ms | 68 ms | 77 ms | 59 ms |
| config loaded | 77 ms | 84 ms | 83 ms | 94 ms | 80 ms |
| keybindings loaded | 77 ms | 85 ms | 83 ms | 95 ms | 80 ms |
| session state loaded | 78 ms | 85 ms | 84 ms | 95 ms | 80 ms |
| extensions scanned | 74 ms | 78 ms | 80 ms | 91 ms | 74 ms |
| themes ready | 82 ms | 88 ms | 88 ms | 99 ms | 83 ms |
| DI container created | 86 ms | 90 ms | 92 ms | 102 ms | 85 ms |
| workbench mounted | 119 ms | 121 ms | 126 ms | 134 ms | 119 ms |
| first frame | 119 ms | 121 ms | 126 ms | 134 ms | 119 ms |
| workbench activated | 127 ms | 131 ms | 137 ms | 142 ms | 125 ms |
| grammars preloaded | 135 ms | 137 ms | 143 ms | 147 ms | 127 ms |
| file read from disk | 137 ms | 140 ms | 154 ms | 210 ms | 134 ms |
| file decoded | 137 ms | 140 ms | 154 ms | 210 ms | 134 ms |
| document built | 137 ms | 140 ms | 154 ms | 210 ms | 134 ms |
| tokenizer attached to editor | 155 ms | 160 ms | 177 ms | 233 ms | — |
| tabs opened | 141 ms | 146 ms | 163 ms | 219 ms | 149 ms |
| built-in extensions registered | 270 ms | 274 ms | 291 ms | 331 ms | 200 ms |
| frame with file text | 154 ms | 158 ms | 175 ms | 231 ms | 163 ms |
| frame with highlighting | 248 ms | 250 ms | 268 ms | 309 ms | — |
| extension host up | 479 ms | 536 ms | 567 ms | 946 ms | 379 ms |
| startup complete | 262 ms | 265 ms | 283 ms | 323 ms | 191 ms |
| to text (black box) | 155 ms | 160 ms | 178 ms | 231 ms | 163 ms |
| to highlight (black box) | 248 ms | 250 ms | 268 ms | 309 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 1 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 26 ms | 14 ms | 12 ms | 8 ms | — | 5 ms | 3 ms |
| `medium` failed | 34 ms | 12 ms | 12 ms | 9 ms | — | 6 ms | 5 ms |
| `large` failed | 32 ms | 23 ms | 21 ms | 19 ms | — | 13 ms | 17 ms |
| `xlarge` failed | 30 ms | 29 ms | 16 ms | 27 ms | — | 12 ms | 71 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
