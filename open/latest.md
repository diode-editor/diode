# File open benchmark

- Recorded: 2026-10-31T18:08:09.631Z, commit `b9a02fbe524d`, diode nightly-b9a02fb
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 24 ms; binary floor (`diode --version` over PTY, median): 64 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **145 ms** | 106 ms | 170 ms | 285 ms | 16 ms | 254 MB | 11 |
| `medium` | 126.7 KB | 2000 | **149 ms** | 109 ms | 173 ms | 294 ms | 8 ms | 280 MB | 11 |
| `large` | 1.3 MB | 20000 | **164 ms** | 124 ms | 188 ms | 323 ms | 13 ms | 297 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **259 ms** | 220 ms | 283 ms | 419 ms | 14 ms | 366 MB | 5 |
| `log500m` | 497 MB | 5295839 | **169 ms** | 130 ms | 193 ms | — (plaintext) | 2 ms | 270 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 8 ms | 9 ms | 6 ms |
| node ready (bootstrapComplete) | 70 ms | 69 ms | 75 ms | 79 ms | 66 ms |
| bundle executed (main:start) | 71 ms | 69 ms | 75 ms | 79 ms | 67 ms |
| config loaded | 87 ms | 89 ms | 93 ms | 96 ms | 84 ms |
| keybindings loaded | 88 ms | 90 ms | 94 ms | 98 ms | 84 ms |
| session state loaded | 88 ms | 90 ms | 94 ms | 98 ms | 84 ms |
| extensions scanned | 84 ms | 86 ms | 90 ms | 92 ms | 80 ms |
| themes ready | 93 ms | 94 ms | 99 ms | 103 ms | 88 ms |
| DI container created | 97 ms | 98 ms | 104 ms | 108 ms | 93 ms |
| workbench mounted | 132 ms | 132 ms | 138 ms | 144 ms | 131 ms |
| first frame | 132 ms | 132 ms | 138 ms | 144 ms | 131 ms |
| workbench activated | 138 ms | 137 ms | 143 ms | 155 ms | 138 ms |
| grammars preloaded | 144 ms | 145 ms | 149 ms | 161 ms | 141 ms |
| file read from disk | 147 ms | 149 ms | 161 ms | 258 ms | 155 ms |
| file decoded | 147 ms | 149 ms | 161 ms | 258 ms | 155 ms |
| document built | 147 ms | 149 ms | 161 ms | 258 ms | 156 ms |
| tokenizer attached to editor | 169 ms | 180 ms | 204 ms | 300 ms | — |
| tabs opened | 150 ms | 156 ms | 174 ms | 269 ms | 177 ms |
| built-in extensions registered | 311 ms | 317 ms | 349 ms | 443 ms | 239 ms |
| frame with file text | 167 ms | 172 ms | 187 ms | 283 ms | 193 ms |
| frame with highlighting | 284 ms | 291 ms | 323 ms | 419 ms | — |
| extension host up | 549 ms | 597 ms | 677 ms | 1133 ms | 434 ms |
| startup complete | 305 ms | 310 ms | 341 ms | 437 ms | 231 ms |
| to text (black box) | 170 ms | 173 ms | 188 ms | 283 ms | 193 ms |
| to highlight (black box) | 285 ms | 294 ms | 323 ms | 419 ms | — |
| gap black − white (text) | 3 ms | 1 ms | 2 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 39 ms | 15 ms | 12 ms | 9 ms | 18 ms | 6 ms | 4 ms |
| `medium` | 37 ms | 14 ms | 11 ms | 10 ms | 16 ms | 8 ms | 4 ms |
| `large` | 39 ms | 21 ms | 22 ms | 17 ms | 39 ms | 18 ms | 14 ms |
| `xlarge` | 31 ms | 32 ms | 21 ms | 20 ms | 113 ms | 13 ms | 79 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
