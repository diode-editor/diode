# File open benchmark

- Recorded: 2026-11-04T08:59:29.715Z, commit `4eb8d2e297ac`, diode nightly-4eb8d2e
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 24 ms; binary floor (`diode --version` over PTY, median): 64 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **148 ms** | 108 ms | 172 ms | 289 ms | 11 ms | 271 MB | 11 |
| `medium` | 126.7 KB | 2000 | **148 ms** | 109 ms | 173 ms | 286 ms | 7 ms | 282 MB | 11 |
| `large` | 1.3 MB | 20000 | **162 ms** | 122 ms | 186 ms | 301 ms | 6 ms | 291 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **264 ms** | 225 ms | 289 ms | 387 ms | 15 ms | 350 MB | 5 |
| `log500m` | 497 MB | 5295839 | **165 ms** | 125 ms | 189 ms | — (plaintext) | 3 ms | 274 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 6 ms | 7 ms | 9 ms | 6 ms |
| node ready (bootstrapComplete) | 70 ms | 70 ms | 71 ms | 92 ms | 65 ms |
| bundle executed (main:start) | 70 ms | 70 ms | 71 ms | 92 ms | 65 ms |
| config loaded | 90 ms | 89 ms | 90 ms | 113 ms | 86 ms |
| keybindings loaded | 92 ms | 91 ms | 90 ms | 116 ms | 87 ms |
| session state loaded | 92 ms | 91 ms | 90 ms | 116 ms | 87 ms |
| extensions scanned | 85 ms | 86 ms | 86 ms | 109 ms | 83 ms |
| themes ready | 95 ms | 94 ms | 95 ms | 119 ms | 91 ms |
| DI container created | 99 ms | 98 ms | 100 ms | 123 ms | 95 ms |
| workbench mounted | 132 ms | 131 ms | 134 ms | 155 ms | 131 ms |
| first frame | 132 ms | 131 ms | 134 ms | 155 ms | 131 ms |
| workbench activated | 142 ms | 138 ms | 139 ms | 160 ms | 137 ms |
| grammars preloaded | 147 ms | 143 ms | 146 ms | 166 ms | 144 ms |
| file read from disk | 150 ms | 147 ms | 160 ms | 263 ms | 155 ms |
| file decoded | 150 ms | 147 ms | 160 ms | 263 ms | 155 ms |
| document built | 150 ms | 148 ms | 161 ms | 263 ms | 155 ms |
| tokenizer attached to editor | 171 ms | 173 ms | 187 ms | 290 ms | — |
| tabs opened | 155 ms | 155 ms | 170 ms | 273 ms | 175 ms |
| built-in extensions registered | 316 ms | 313 ms | 330 ms | 411 ms | 234 ms |
| frame with file text | 170 ms | 170 ms | 185 ms | 289 ms | 189 ms |
| frame with highlighting | 289 ms | 286 ms | 301 ms | 387 ms | — |
| extension host up | 572 ms | 602 ms | 687 ms | 1122 ms | 445 ms |
| startup complete | 308 ms | 303 ms | 322 ms | 404 ms | 224 ms |
| to text (black box) | 172 ms | 173 ms | 186 ms | 289 ms | 189 ms |
| to highlight (black box) | 289 ms | 286 ms | 301 ms | 387 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 38 ms | 13 ms | 10 ms | 12 ms | — | 8 ms | 4 ms |
| `medium` failed | 36 ms | 16 ms | 12 ms | 13 ms | — | 9 ms | 12 ms |
| `large` failed | 37 ms | 25 ms | 22 ms | 22 ms | — | 15 ms | 20 ms |
| `xlarge` failed | 33 ms | 42 ms | 25 ms | 40 ms | — | 28 ms | 87 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
