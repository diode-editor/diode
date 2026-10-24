# File open benchmark

- Recorded: 2026-10-24T18:09:37.552Z, commit `1e45c9e8e571`, diode nightly-1e45c9e
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 61 ms; for reference `node --version`: 5 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **140 ms** | 104 ms | 165 ms | 281 ms | 8 ms | 248 MB | 11 |
| `medium` | 126.7 KB | 2000 | **148 ms** | 112 ms | 173 ms | 292 ms | 4 ms | 264 MB | 11 |
| `large` | 1.3 MB | 20000 | **166 ms** | 130 ms | 191 ms | 312 ms | 8 ms | 285 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **249 ms** | 212 ms | 274 ms | 378 ms | 15 ms | 349 MB | 5 |
| `log500m` | 497 MB | 5295839 | **164 ms** | 128 ms | 189 ms | — (plaintext) | 2 ms | 263 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 7 ms | 10 ms | 6 ms |
| node ready (bootstrapComplete) | 67 ms | 70 ms | 72 ms | 83 ms | 63 ms |
| bundle executed (main:start) | 67 ms | 70 ms | 72 ms | 83 ms | 63 ms |
| config loaded | 88 ms | 90 ms | 90 ms | 102 ms | 83 ms |
| keybindings loaded | 88 ms | 91 ms | 90 ms | 102 ms | 83 ms |
| session state loaded | 89 ms | 91 ms | 90 ms | 102 ms | 83 ms |
| extensions scanned | 82 ms | 86 ms | 87 ms | 98 ms | 79 ms |
| themes ready | 91 ms | 95 ms | 95 ms | 107 ms | 88 ms |
| DI container created | 97 ms | 99 ms | 100 ms | 112 ms | 93 ms |
| workbench mounted | 127 ms | 130 ms | 135 ms | 144 ms | 127 ms |
| first frame | 127 ms | 130 ms | 135 ms | 144 ms | 127 ms |
| workbench activated | 132 ms | 139 ms | 146 ms | 150 ms | 134 ms |
| grammars preloaded | 139 ms | 145 ms | 152 ms | 156 ms | 137 ms |
| file read from disk | 141 ms | 149 ms | 165 ms | 251 ms | 152 ms |
| file decoded | 141 ms | 149 ms | 165 ms | 251 ms | 152 ms |
| document built | 142 ms | 150 ms | 165 ms | 251 ms | 153 ms |
| tokenizer attached to editor | 164 ms | 174 ms | 190 ms | 276 ms | — |
| tabs opened | 145 ms | 156 ms | 174 ms | 261 ms | 173 ms |
| built-in extensions registered | 301 ms | 311 ms | 331 ms | 397 ms | 226 ms |
| frame with file text | 163 ms | 172 ms | 189 ms | 274 ms | 186 ms |
| frame with highlighting | 281 ms | 291 ms | 312 ms | 377 ms | — |
| extension host up | 537 ms | 574 ms | 631 ms | 964 ms | 423 ms |
| startup complete | 296 ms | 306 ms | 326 ms | 393 ms | 220 ms |
| to text (black box) | 165 ms | 173 ms | 191 ms | 274 ms | 189 ms |
| to highlight (black box) | 281 ms | 292 ms | 312 ms | 378 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 2 ms | 0 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 34 ms | 13 ms | 10 ms | 12 ms | 22 ms | 7 ms | 4 ms |
| `medium` | 37 ms | 15 ms | 12 ms | 12 ms | 16 ms | 7 ms | 10 ms |
| `large` | 34 ms | 18 ms | 17 ms | 17 ms | 45 ms | 16 ms | 17 ms |
| `xlarge` | 29 ms | 24 ms | 9 ms | 11 ms | 104 ms | 12 ms | 79 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
