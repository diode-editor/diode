# File open benchmark

- Recorded: 2026-11-02T08:32:45.250Z, commit `d6362926bcf7`, diode nightly-d636292
- Machine: INTEL(R) XEON(R) PLATINUM 8573C (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 26 ms; binary floor (`diode --version` over PTY, median): 62 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **142 ms** | 106 ms | 168 ms | 283 ms | 8 ms | 256 MB | 11 |
| `medium` | 126.7 KB | 2000 | **145 ms** | 108 ms | 170 ms | 297 ms | 6 ms | 280 MB | 11 |
| `large` | 1.3 MB | 20000 | **156 ms** | 119 ms | 181 ms | 318 ms | 5 ms | 295 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **245 ms** | 208 ms | 270 ms | 397 ms | 18 ms | 373 MB | 5 |
| `log500m` | 497 MB | 5295839 | **156 ms** | 119 ms | 181 ms | — (plaintext) | 1 ms | 273 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 6 ms | 6 ms | 9 ms | 5 ms |
| node ready (bootstrapComplete) | 68 ms | 67 ms | 67 ms | 70 ms | 65 ms |
| bundle executed (main:start) | 68 ms | 67 ms | 67 ms | 70 ms | 65 ms |
| config loaded | 85 ms | 84 ms | 85 ms | 92 ms | 83 ms |
| keybindings loaded | 86 ms | 85 ms | 85 ms | 92 ms | 84 ms |
| session state loaded | 86 ms | 85 ms | 85 ms | 93 ms | 84 ms |
| extensions scanned | 82 ms | 80 ms | 80 ms | 87 ms | 78 ms |
| themes ready | 91 ms | 90 ms | 90 ms | 95 ms | 89 ms |
| DI container created | 94 ms | 94 ms | 94 ms | 99 ms | 93 ms |
| workbench mounted | 126 ms | 126 ms | 126 ms | 130 ms | 125 ms |
| first frame | 126 ms | 126 ms | 125 ms | 130 ms | 125 ms |
| workbench activated | 132 ms | 132 ms | 130 ms | 135 ms | 131 ms |
| grammars preloaded | 141 ms | 143 ms | 142 ms | 144 ms | 138 ms |
| file read from disk | 144 ms | 147 ms | 155 ms | 242 ms | 148 ms |
| file decoded | 144 ms | 147 ms | 155 ms | 242 ms | 148 ms |
| document built | 144 ms | 147 ms | 155 ms | 242 ms | 148 ms |
| tokenizer attached to editor | 166 ms | 175 ms | 197 ms | 284 ms | — |
| tabs opened | 149 ms | 153 ms | 166 ms | 252 ms | 165 ms |
| built-in extensions registered | 304 ms | 316 ms | 337 ms | 415 ms | 219 ms |
| frame with file text | 165 ms | 168 ms | 180 ms | 267 ms | 181 ms |
| frame with highlighting | 283 ms | 296 ms | 318 ms | 397 ms | — |
| extension host up | 525 ms | 562 ms | 634 ms | 1073 ms | 406 ms |
| startup complete | 298 ms | 311 ms | 330 ms | 409 ms | 212 ms |
| to text (black box) | 168 ms | 170 ms | 181 ms | 270 ms | 181 ms |
| to highlight (black box) | 283 ms | 297 ms | 318 ms | 397 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 1 ms | 2 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 34 ms | 10 ms | 9 ms | 8 ms | 18 ms | 8 ms | 4 ms |
| `medium` | 34 ms | 14 ms | 13 ms | 10 ms | 25 ms | 7 ms | 6 ms |
| `large` | 40 ms | 20 ms | 22 ms | 24 ms | 41 ms | 13 ms | 20 ms |
| `xlarge` | 40 ms | 34 ms | 19 ms | 22 ms | 184 ms | 13 ms | 89 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
