# File open benchmark

- Recorded: 2026-11-17T00:44:48.612Z, commit `ec677f1d636c`, diode nightly-ec677f1
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 23 ms; binary floor (`diode --version` over PTY, median): 69 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **170 ms** | 124 ms | 193 ms | 303 ms | 5 ms | 282 MB | 11 |
| `medium` | 126.7 KB | 2000 | **176 ms** | 130 ms | 199 ms | 310 ms | 7 ms | 293 MB | 11 |
| `large` | 1.3 MB | 20000 | **190 ms** | 144 ms | 213 ms | 329 ms | 10 ms | 303 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **282 ms** | 237 ms | 305 ms | 404 ms | 14 ms | 356 MB | 5 |
| `log500m` | 497 MB | 5295839 | **189 ms** | 144 ms | 212 ms | — (plaintext) | 6 ms | 315 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 7 ms | 10 ms | 6 ms |
| node ready (bootstrapComplete) | 76 ms | 77 ms | 80 ms | 95 ms | 73 ms |
| bundle executed (main:start) | 76 ms | 77 ms | 81 ms | 95 ms | 73 ms |
| config loaded | 96 ms | 98 ms | 102 ms | 114 ms | 95 ms |
| keybindings loaded | 98 ms | 98 ms | 103 ms | 115 ms | 96 ms |
| session state loaded | 98 ms | 99 ms | 103 ms | 115 ms | 96 ms |
| extensions scanned | 90 ms | 92 ms | 97 ms | 109 ms | 88 ms |
| themes ready | 104 ms | 103 ms | 108 ms | 120 ms | 101 ms |
| DI container created | 108 ms | 108 ms | 113 ms | 124 ms | 105 ms |
| workbench mounted | 153 ms | 154 ms | 160 ms | 166 ms | 146 ms |
| first frame | 153 ms | 154 ms | 160 ms | 166 ms | 146 ms |
| workbench activated | 160 ms | 161 ms | 168 ms | 175 ms | 154 ms |
| grammars preloaded | 166 ms | 166 ms | 172 ms | 180 ms | 157 ms |
| file read from disk | 168 ms | 171 ms | 185 ms | 279 ms | 171 ms |
| file decoded | 168 ms | 171 ms | 185 ms | 279 ms | 171 ms |
| document built | 169 ms | 171 ms | 185 ms | 279 ms | 172 ms |
| tokenizer attached to editor | 191 ms | 198 ms | 215 ms | 307 ms | — |
| tabs opened | 174 ms | 177 ms | 195 ms | 290 ms | 193 ms |
| built-in extensions registered | 333 ms | 339 ms | 357 ms | 433 ms | 259 ms |
| frame with file text | 190 ms | 197 ms | 212 ms | 305 ms | 211 ms |
| frame with highlighting | 303 ms | 310 ms | 329 ms | 404 ms | — |
| extension host up | 584 ms | 628 ms | 714 ms | 1161 ms | 468 ms |
| startup complete | 323 ms | 330 ms | 347 ms | 423 ms | 248 ms |
| to text (black box) | 193 ms | 199 ms | 213 ms | 305 ms | 212 ms |
| to highlight (black box) | 303 ms | 310 ms | 329 ms | 404 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 1 ms | 0 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 38 ms | 18 ms | 13 ms | 11 ms | — | 6 ms | 3 ms |
| `medium` failed | 36 ms | 14 ms | 14 ms | 9 ms | — | 9 ms | 6 ms |
| `large` failed | 34 ms | 27 ms | 22 ms | 24 ms | — | 19 ms | 19 ms |
| `xlarge` failed | 29 ms | 43 ms | 33 ms | 31 ms | — | 14 ms | 81 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
