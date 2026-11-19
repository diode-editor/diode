# File open benchmark

- Recorded: 2026-11-19T13:43:44.768Z, commit `2d933785bf73`, diode nightly-2d93378
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 22 ms; binary floor (`diode --version` over PTY, median): 65 ms; for reference `node --version`: 5 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **141 ms** | 98 ms | 163 ms | 255 ms | 11 ms | 294 MB | 11 |
| `medium` | 126.7 KB | 2000 | **140 ms** | 97 ms | 162 ms | 250 ms | 2 ms | 303 MB | 11 |
| `large` | 1.3 MB | 20000 | **153 ms** | 110 ms | 175 ms | 264 ms | 8 ms | 315 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **220 ms** | 178 ms | 242 ms | 315 ms | 14 ms | 365 MB | 5 |
| `log500m` | 497 MB | 5295839 | **146 ms** | 103 ms | 168 ms | — (plaintext) | 4 ms | 335 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 6 ms | 9 ms | 5 ms |
| node ready (bootstrapComplete) | 67 ms | 67 ms | 68 ms | 75 ms | 63 ms |
| bundle executed (main:start) | 67 ms | 67 ms | 68 ms | 75 ms | 63 ms |
| config loaded | 88 ms | 86 ms | 85 ms | 97 ms | 85 ms |
| keybindings loaded | 89 ms | 87 ms | 87 ms | 97 ms | 85 ms |
| session state loaded | 89 ms | 88 ms | 87 ms | 97 ms | 86 ms |
| extensions scanned | 81 ms | 81 ms | 81 ms | 89 ms | 81 ms |
| themes ready | 92 ms | 91 ms | 91 ms | 100 ms | 88 ms |
| DI container created | 94 ms | 93 ms | 93 ms | 103 ms | 91 ms |
| workbench mounted | 130 ms | 127 ms | 129 ms | 140 ms | 123 ms |
| first frame | 130 ms | 127 ms | 129 ms | 140 ms | 123 ms |
| workbench activated | 136 ms | 132 ms | 140 ms | 152 ms | 130 ms |
| grammars preloaded | 140 ms | 136 ms | 144 ms | 155 ms | 132 ms |
| file read from disk | 143 ms | 140 ms | 153 ms | 217 ms | 141 ms |
| file decoded | 144 ms | 140 ms | 153 ms | 217 ms | 141 ms |
| document built | 144 ms | 140 ms | 154 ms | 217 ms | 141 ms |
| tokenizer attached to editor | 161 ms | 161 ms | 176 ms | 240 ms | — |
| tabs opened | 147 ms | 146 ms | 161 ms | 225 ms | 155 ms |
| built-in extensions registered | 283 ms | 278 ms | 293 ms | 342 ms | 210 ms |
| frame with file text | 161 ms | 160 ms | 174 ms | 238 ms | 168 ms |
| frame with highlighting | 255 ms | 249 ms | 264 ms | 315 ms | — |
| extension host up | 489 ms | 516 ms | 575 ms | 947 ms | 364 ms |
| startup complete | 273 ms | 267 ms | 283 ms | 334 ms | 200 ms |
| to text (black box) | 163 ms | 162 ms | 175 ms | 242 ms | 168 ms |
| to highlight (black box) | 255 ms | 250 ms | 264 ms | 315 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 2 ms | 2 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 26 ms | 11 ms | 9 ms | 11 ms | — | 5 ms | 3 ms |
| `medium` failed | 25 ms | 14 ms | 9 ms | 9 ms | — | 6 ms | 5 ms |
| `large` failed | 37 ms | 21 ms | 20 ms | 15 ms | — | 14 ms | 16 ms |
| `xlarge` failed | 37 ms | 42 ms | 24 ms | 24 ms | — | 13 ms | 65 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
