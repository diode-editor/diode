# File open benchmark

- Recorded: 2026-10-30T05:05:27.785Z, commit `ea2797489bf8`, diode nightly-ea27974
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 61 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **132 ms** | 96 ms | 157 ms | 278 ms | 6 ms | 263 MB | 11 |
| `medium` | 126.7 KB | 2000 | **139 ms** | 103 ms | 164 ms | 283 ms | 6 ms | 278 MB | 11 |
| `large` | 1.3 MB | 20000 | **153 ms** | 117 ms | 178 ms | 310 ms | 5 ms | 294 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **235 ms** | 199 ms | 260 ms | 387 ms | 1 ms | 369 MB | 5 |
| `log500m` | 497 MB | 5295839 | **156 ms** | 120 ms | 181 ms | — (plaintext) | 2 ms | 270 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 6 ms | 8 ms | 7 ms | 6 ms |
| node ready (bootstrapComplete) | 65 ms | 63 ms | 68 ms | 78 ms | 61 ms |
| bundle executed (main:start) | 65 ms | 63 ms | 68 ms | 78 ms | 61 ms |
| config loaded | 84 ms | 81 ms | 83 ms | 94 ms | 77 ms |
| keybindings loaded | 85 ms | 81 ms | 86 ms | 95 ms | 77 ms |
| session state loaded | 85 ms | 81 ms | 86 ms | 95 ms | 77 ms |
| extensions scanned | 81 ms | 78 ms | 81 ms | 91 ms | 73 ms |
| themes ready | 89 ms | 86 ms | 89 ms | 102 ms | 84 ms |
| DI container created | 93 ms | 90 ms | 92 ms | 106 ms | 88 ms |
| workbench mounted | 123 ms | 125 ms | 127 ms | 137 ms | 123 ms |
| first frame | 123 ms | 125 ms | 127 ms | 137 ms | 123 ms |
| workbench activated | 128 ms | 130 ms | 132 ms | 142 ms | 130 ms |
| grammars preloaded | 134 ms | 138 ms | 139 ms | 150 ms | 135 ms |
| file read from disk | 136 ms | 142 ms | 153 ms | 236 ms | 146 ms |
| file decoded | 136 ms | 142 ms | 153 ms | 236 ms | 146 ms |
| document built | 137 ms | 142 ms | 154 ms | 237 ms | 146 ms |
| tokenizer attached to editor | 159 ms | 171 ms | 194 ms | 277 ms | — |
| tabs opened | 140 ms | 149 ms | 163 ms | 247 ms | 165 ms |
| built-in extensions registered | 304 ms | 308 ms | 334 ms | 410 ms | 224 ms |
| frame with file text | 157 ms | 163 ms | 177 ms | 260 ms | 179 ms |
| frame with highlighting | 275 ms | 283 ms | 310 ms | 387 ms | — |
| extension host up | 538 ms | 581 ms | 638 ms | 1066 ms | 408 ms |
| startup complete | 298 ms | 302 ms | 327 ms | 404 ms | 217 ms |
| to text (black box) | 157 ms | 164 ms | 178 ms | 260 ms | 181 ms |
| to highlight (black box) | 278 ms | 283 ms | 310 ms | 387 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 1 ms | 0 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 33 ms | 15 ms | 14 ms | 9 ms | 17 ms | 8 ms | 4 ms |
| `medium` | 32 ms | 14 ms | 10 ms | 10 ms | 20 ms | 7 ms | 5 ms |
| `large` | 34 ms | 23 ms | 14 ms | 19 ms | 47 ms | 15 ms | 14 ms |
| `xlarge` | 27 ms | 19 ms | 9 ms | 13 ms | 92 ms | 8 ms | 86 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
