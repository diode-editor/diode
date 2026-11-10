# File open benchmark

- Recorded: 2026-11-10T01:10:13.013Z, commit `42b03237d22e`, diode nightly-42b0323
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 28 ms; binary floor (`diode --version` over PTY, median): 77 ms; for reference `node --version`: 6 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **172 ms** | 123 ms | 200 ms | 326 ms | 10 ms | 269 MB | 11 |
| `medium` | 126.7 KB | 2000 | **186 ms** | 137 ms | 214 ms | 345 ms | 20 ms | 288 MB | 11 |
| `large` | 1.3 MB | 20000 | **211 ms** | 161 ms | 239 ms | 366 ms | 7 ms | 296 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **290 ms** | 241 ms | 318 ms | 424 ms | 19 ms | 352 MB | 5 |
| `log500m` | 497 MB | 5295839 | **194 ms** | 145 ms | 222 ms | — (plaintext) | 6 ms | 305 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 8 ms | 8 ms | 9 ms | 13 ms | 7 ms |
| node ready (bootstrapComplete) | 79 ms | 85 ms | 92 ms | 104 ms | 78 ms |
| bundle executed (main:start) | 79 ms | 85 ms | 92 ms | 104 ms | 78 ms |
| config loaded | 103 ms | 112 ms | 111 ms | 126 ms | 105 ms |
| keybindings loaded | 104 ms | 113 ms | 112 ms | 127 ms | 105 ms |
| session state loaded | 104 ms | 113 ms | 112 ms | 127 ms | 105 ms |
| extensions scanned | 98 ms | 101 ms | 106 ms | 121 ms | 99 ms |
| themes ready | 109 ms | 118 ms | 118 ms | 133 ms | 109 ms |
| DI container created | 113 ms | 121 ms | 123 ms | 138 ms | 113 ms |
| workbench mounted | 159 ms | 164 ms | 177 ms | 181 ms | 155 ms |
| first frame | 159 ms | 164 ms | 177 ms | 181 ms | 155 ms |
| workbench activated | 167 ms | 172 ms | 185 ms | 189 ms | 163 ms |
| grammars preloaded | 172 ms | 179 ms | 192 ms | 195 ms | 166 ms |
| file read from disk | 176 ms | 184 ms | 205 ms | 285 ms | 178 ms |
| file decoded | 176 ms | 184 ms | 205 ms | 285 ms | 178 ms |
| document built | 176 ms | 184 ms | 206 ms | 285 ms | 178 ms |
| tokenizer attached to editor | 199 ms | 214 ms | 241 ms | 319 ms | — |
| tabs opened | 181 ms | 192 ms | 215 ms | 296 ms | 202 ms |
| built-in extensions registered | 354 ms | 375 ms | 397 ms | 456 ms | 275 ms |
| frame with file text | 198 ms | 212 ms | 239 ms | 317 ms | 222 ms |
| frame with highlighting | 326 ms | 345 ms | 366 ms | 423 ms | — |
| extension host up | 626 ms | 706 ms | 790 ms | 1222 ms | 505 ms |
| startup complete | 345 ms | 365 ms | 386 ms | 445 ms | 263 ms |
| to text (black box) | 200 ms | 214 ms | 239 ms | 318 ms | 222 ms |
| to highlight (black box) | 326 ms | 345 ms | 366 ms | 424 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 1 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 40 ms | 20 ms | 13 ms | 12 ms | — | 8 ms | 5 ms |
| `medium` failed | 36 ms | 18 ms | 16 ms | 13 ms | — | 8 ms | 11 ms |
| `large` failed | 44 ms | 25 ms | 29 ms | 20 ms | — | 25 ms | 18 ms |
| `xlarge` failed | 40 ms | 30 ms | 22 ms | 37 ms | — | 26 ms | 91 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
