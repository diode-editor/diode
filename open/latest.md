# File open benchmark

- Recorded: 2026-10-26T07:31:58.379Z, commit `48de2b61d7c3`, diode nightly-48de2b6
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 61 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **140 ms** | 104 ms | 165 ms | 284 ms | 8 ms | 253 MB | 11 |
| `medium` | 126.7 KB | 2000 | **151 ms** | 116 ms | 176 ms | 294 ms | 9 ms | 277 MB | 11 |
| `large` | 1.3 MB | 20000 | **162 ms** | 126 ms | 187 ms | 307 ms | 4 ms | 294 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **247 ms** | 211 ms | 271 ms | 377 ms | 5 ms | 365 MB | 5 |
| `log500m` | 497 MB | 5295839 | **155 ms** | 119 ms | 179 ms | — (plaintext) | 2 ms | 272 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 7 ms | 9 ms | 6 ms |
| node ready (bootstrapComplete) | 67 ms | 71 ms | 73 ms | 80 ms | 62 ms |
| bundle executed (main:start) | 67 ms | 71 ms | 73 ms | 80 ms | 62 ms |
| config loaded | 88 ms | 90 ms | 89 ms | 97 ms | 79 ms |
| keybindings loaded | 90 ms | 91 ms | 89 ms | 98 ms | 80 ms |
| session state loaded | 91 ms | 91 ms | 89 ms | 98 ms | 80 ms |
| extensions scanned | 84 ms | 86 ms | 85 ms | 93 ms | 76 ms |
| themes ready | 93 ms | 96 ms | 94 ms | 103 ms | 85 ms |
| DI container created | 97 ms | 100 ms | 99 ms | 107 ms | 89 ms |
| workbench mounted | 129 ms | 136 ms | 134 ms | 140 ms | 123 ms |
| first frame | 129 ms | 136 ms | 134 ms | 139 ms | 123 ms |
| workbench activated | 137 ms | 144 ms | 142 ms | 145 ms | 127 ms |
| grammars preloaded | 144 ms | 149 ms | 147 ms | 155 ms | 134 ms |
| file read from disk | 146 ms | 153 ms | 160 ms | 249 ms | 146 ms |
| file decoded | 146 ms | 154 ms | 160 ms | 249 ms | 147 ms |
| document built | 147 ms | 154 ms | 161 ms | 250 ms | 147 ms |
| tokenizer attached to editor | 166 ms | 176 ms | 187 ms | 274 ms | — |
| tabs opened | 150 ms | 160 ms | 170 ms | 258 ms | 167 ms |
| built-in extensions registered | 307 ms | 317 ms | 328 ms | 398 ms | 218 ms |
| frame with file text | 165 ms | 175 ms | 184 ms | 271 ms | 179 ms |
| frame with highlighting | 283 ms | 294 ms | 306 ms | 377 ms | — |
| extension host up | 554 ms | 607 ms | 661 ms | 974 ms | 404 ms |
| startup complete | 301 ms | 309 ms | 321 ms | 391 ms | 211 ms |
| to text (black box) | 165 ms | 176 ms | 187 ms | 271 ms | 179 ms |
| to highlight (black box) | 284 ms | 294 ms | 307 ms | 377 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 2 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 33 ms | 14 ms | 11 ms | 12 ms | 15 ms | 8 ms | 4 ms |
| `medium` | 34 ms | 14 ms | 10 ms | 8 ms | 17 ms | 8 ms | 5 ms |
| `large` | 47 ms | 25 ms | 20 ms | 15 ms | 49 ms | 17 ms | 18 ms |
| `xlarge` | 28 ms | 14 ms | 10 ms | 12 ms | 102 ms | 8 ms | 80 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
