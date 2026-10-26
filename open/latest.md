# File open benchmark

- Recorded: 2026-10-26T00:28:32.184Z, commit `b82f0c4252e9`, diode nightly-b82f0c4
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 26 ms; binary floor (`diode --version` over PTY, median): 65 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **146 ms** | 107 ms | 171 ms | 287 ms | 12 ms | 250 MB | 11 |
| `medium` | 126.7 KB | 2000 | **145 ms** | 106 ms | 170 ms | 289 ms | 11 ms | 258 MB | 11 |
| `large` | 1.3 MB | 20000 | **162 ms** | 122 ms | 187 ms | 306 ms | 11 ms | 283 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **255 ms** | 216 ms | 281 ms | 391 ms | 9 ms | 350 MB | 5 |
| `log500m` | 497 MB | 5295839 | **157 ms** | 117 ms | 182 ms | — (plaintext) | 6 ms | 263 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 7 ms | 10 ms | 6 ms |
| node ready (bootstrapComplete) | 69 ms | 68 ms | 70 ms | 85 ms | 63 ms |
| bundle executed (main:start) | 69 ms | 68 ms | 70 ms | 85 ms | 63 ms |
| config loaded | 89 ms | 88 ms | 89 ms | 105 ms | 84 ms |
| keybindings loaded | 90 ms | 88 ms | 89 ms | 106 ms | 85 ms |
| session state loaded | 90 ms | 88 ms | 89 ms | 107 ms | 86 ms |
| extensions scanned | 85 ms | 85 ms | 85 ms | 101 ms | 80 ms |
| themes ready | 95 ms | 92 ms | 94 ms | 111 ms | 90 ms |
| DI container created | 100 ms | 96 ms | 98 ms | 115 ms | 95 ms |
| workbench mounted | 133 ms | 130 ms | 134 ms | 148 ms | 127 ms |
| first frame | 133 ms | 130 ms | 134 ms | 148 ms | 127 ms |
| workbench activated | 141 ms | 135 ms | 142 ms | 156 ms | 134 ms |
| grammars preloaded | 146 ms | 145 ms | 148 ms | 162 ms | 137 ms |
| file read from disk | 149 ms | 149 ms | 162 ms | 258 ms | 149 ms |
| file decoded | 149 ms | 149 ms | 162 ms | 258 ms | 149 ms |
| document built | 149 ms | 149 ms | 162 ms | 258 ms | 149 ms |
| tokenizer attached to editor | 171 ms | 172 ms | 189 ms | 283 ms | — |
| tabs opened | 154 ms | 155 ms | 171 ms | 268 ms | 168 ms |
| built-in extensions registered | 307 ms | 308 ms | 325 ms | 410 ms | 219 ms |
| frame with file text | 170 ms | 170 ms | 187 ms | 281 ms | 182 ms |
| frame with highlighting | 286 ms | 289 ms | 306 ms | 391 ms | — |
| extension host up | 541 ms | 561 ms | 626 ms | 970 ms | 395 ms |
| startup complete | 302 ms | 303 ms | 320 ms | 406 ms | 213 ms |
| to text (black box) | 171 ms | 170 ms | 187 ms | 281 ms | 182 ms |
| to highlight (black box) | 287 ms | 289 ms | 306 ms | 391 ms | — |
| gap black − white (text) | 2 ms | 1 ms | 0 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 38 ms | 13 ms | 10 ms | 11 ms | 17 ms | 8 ms | 4 ms |
| `medium` | 34 ms | 12 ms | 11 ms | 10 ms | 15 ms | 9 ms | 6 ms |
| `large` | 37 ms | 18 ms | 14 ms | 22 ms | 41 ms | 20 ms | 16 ms |
| `xlarge` | 29 ms | 23 ms | 14 ms | 16 ms | 110 ms | 13 ms | 90 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
