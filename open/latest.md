# File open benchmark

- Recorded: 2026-11-10T08:57:04.051Z, commit `723fc9429133`, diode nightly-723fc94
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 65 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **156 ms** | 116 ms | 181 ms | 297 ms | 16 ms | 280 MB | 11 |
| `medium` | 126.7 KB | 2000 | **159 ms** | 119 ms | 184 ms | 297 ms | 11 ms | 287 MB | 11 |
| `large` | 1.3 MB | 20000 | **178 ms** | 137 ms | 203 ms | 316 ms | 23 ms | 298 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **260 ms** | 219 ms | 285 ms | 380 ms | 9 ms | 354 MB | 5 |
| `log500m` | 497 MB | 5295839 | **174 ms** | 134 ms | 199 ms | — (plaintext) | 10 ms | 308 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 7 ms | 9 ms | 6 ms |
| node ready (bootstrapComplete) | 72 ms | 72 ms | 71 ms | 82 ms | 67 ms |
| bundle executed (main:start) | 72 ms | 72 ms | 71 ms | 82 ms | 67 ms |
| config loaded | 94 ms | 91 ms | 94 ms | 106 ms | 87 ms |
| keybindings loaded | 94 ms | 91 ms | 94 ms | 106 ms | 87 ms |
| session state loaded | 94 ms | 91 ms | 94 ms | 106 ms | 87 ms |
| extensions scanned | 88 ms | 86 ms | 91 ms | 99 ms | 82 ms |
| themes ready | 99 ms | 96 ms | 98 ms | 109 ms | 94 ms |
| DI container created | 103 ms | 100 ms | 101 ms | 112 ms | 98 ms |
| workbench mounted | 138 ms | 146 ms | 146 ms | 149 ms | 143 ms |
| first frame | 138 ms | 145 ms | 146 ms | 149 ms | 143 ms |
| workbench activated | 146 ms | 152 ms | 153 ms | 157 ms | 150 ms |
| grammars preloaded | 151 ms | 158 ms | 159 ms | 161 ms | 153 ms |
| file read from disk | 154 ms | 162 ms | 173 ms | 255 ms | 165 ms |
| file decoded | 154 ms | 162 ms | 173 ms | 255 ms | 165 ms |
| document built | 154 ms | 162 ms | 173 ms | 256 ms | 166 ms |
| tokenizer attached to editor | 178 ms | 185 ms | 201 ms | 285 ms | — |
| tabs opened | 159 ms | 170 ms | 182 ms | 265 ms | 185 ms |
| built-in extensions registered | 325 ms | 326 ms | 345 ms | 409 ms | 246 ms |
| frame with file text | 177 ms | 184 ms | 200 ms | 283 ms | 199 ms |
| frame with highlighting | 296 ms | 297 ms | 315 ms | 380 ms | — |
| extension host up | 583 ms | 619 ms | 687 ms | 1098 ms | 455 ms |
| startup complete | 315 ms | 316 ms | 334 ms | 398 ms | 236 ms |
| to text (black box) | 181 ms | 184 ms | 203 ms | 285 ms | 199 ms |
| to highlight (black box) | 297 ms | 297 ms | 316 ms | 380 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 1 ms | 2 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 36 ms | 13 ms | 12 ms | 12 ms | — | 9 ms | 5 ms |
| `medium` failed | 35 ms | 13 ms | 12 ms | 10 ms | — | 7 ms | 7 ms |
| `large` failed | 32 ms | 21 ms | 23 ms | 20 ms | — | 16 ms | 18 ms |
| `xlarge` failed | 27 ms | 41 ms | 28 ms | 62 ms | — | 24 ms | 84 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
