# File open benchmark

- Recorded: 2026-10-31T07:24:42.520Z, commit `f3cfdddc22e7`, diode nightly-f3cfddd
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 19 ms; binary floor (`diode --version` over PTY, median): 54 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **109 ms** | 74 ms | 128 ms | 218 ms | 6 ms | 256 MB | 11 |
| `medium` | 126.7 KB | 2000 | **109 ms** | 74 ms | 128 ms | 219 ms | 2 ms | 278 MB | 11 |
| `large` | 1.3 MB | 20000 | **123 ms** | 88 ms | 142 ms | 241 ms | 6 ms | 296 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **195 ms** | 160 ms | 214 ms | 319 ms | 7 ms | 375 MB | 5 |
| `log500m` | 497 MB | 5295839 | **127 ms** | 93 ms | 147 ms | — (plaintext) | 5 ms | 309 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 5 ms | 6 ms | 9 ms | 5 ms |
| node ready (bootstrapComplete) | 55 ms | 56 ms | 59 ms | 70 ms | 54 ms |
| bundle executed (main:start) | 55 ms | 56 ms | 59 ms | 70 ms | 54 ms |
| config loaded | 70 ms | 72 ms | 78 ms | 88 ms | 69 ms |
| keybindings loaded | 72 ms | 72 ms | 78 ms | 89 ms | 69 ms |
| session state loaded | 72 ms | 72 ms | 78 ms | 89 ms | 69 ms |
| extensions scanned | 67 ms | 68 ms | 76 ms | 85 ms | 66 ms |
| themes ready | 75 ms | 75 ms | 81 ms | 91 ms | 72 ms |
| DI container created | 78 ms | 78 ms | 83 ms | 93 ms | 76 ms |
| workbench mounted | 102 ms | 100 ms | 105 ms | 114 ms | 102 ms |
| first frame | 102 ms | 99 ms | 105 ms | 114 ms | 102 ms |
| workbench activated | 105 ms | 103 ms | 109 ms | 119 ms | 106 ms |
| grammars preloaded | 113 ms | 107 ms | 113 ms | 122 ms | 112 ms |
| file read from disk | 115 ms | 110 ms | 122 ms | 191 ms | 121 ms |
| file decoded | 115 ms | 110 ms | 122 ms | 191 ms | 121 ms |
| document built | 115 ms | 110 ms | 122 ms | 191 ms | 121 ms |
| tokenizer attached to editor | 129 ms | 132 ms | 156 ms | 228 ms | — |
| tabs opened | 117 ms | 115 ms | 129 ms | 199 ms | 136 ms |
| built-in extensions registered | 240 ms | 241 ms | 260 ms | 337 ms | 178 ms |
| frame with file text | 127 ms | 126 ms | 140 ms | 211 ms | 147 ms |
| frame with highlighting | 218 ms | 219 ms | 240 ms | 319 ms | — |
| extension host up | 422 ms | 449 ms | 520 ms | 878 ms | 320 ms |
| startup complete | 235 ms | 236 ms | 255 ms | 332 ms | 173 ms |
| to text (black box) | 128 ms | 128 ms | 142 ms | 214 ms | 147 ms |
| to highlight (black box) | 218 ms | 219 ms | 241 ms | 319 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 2 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 24 ms | 10 ms | 7 ms | 8 ms | 11 ms | 7 ms | 3 ms |
| `medium` | 23 ms | 8 ms | 7 ms | 6 ms | 12 ms | 5 ms | 4 ms |
| `large` | 41 ms | 17 ms | 13 ms | 14 ms | 36 ms | 12 ms | 14 ms |
| `xlarge` | 27 ms | 23 ms | 12 ms | 16 ms | 156 ms | 15 ms | 57 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
