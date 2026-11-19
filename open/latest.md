# File open benchmark

- Recorded: 2026-11-19T17:09:06.412Z, commit `58687e20c493`, diode nightly-58687e2
- Machine: INTEL(R) XEON(R) PLATINUM 8573C (4 cores, 16 GB), linux 7.0.0-1020-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 23 ms; binary floor (`diode --version` over PTY, median): 64 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **154 ms** | 114 ms | 177 ms | 278 ms | 10 ms | 294 MB | 11 |
| `medium` | 126.7 KB | 2000 | **156 ms** | 116 ms | 179 ms | 289 ms | 4 ms | 302 MB | 11 |
| `large` | 1.3 MB | 20000 | **167 ms** | 126 ms | 190 ms | 298 ms | 7 ms | 315 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **261 ms** | 220 ms | 284 ms | 378 ms | 22 ms | 366 MB | 5 |
| `log500m` | 497 MB | 5295839 | **166 ms** | 125 ms | 189 ms | — (plaintext) | 5 ms | 336 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 6 ms | 9 ms | 5 ms |
| node ready (bootstrapComplete) | 70 ms | 71 ms | 72 ms | 82 ms | 69 ms |
| bundle executed (main:start) | 70 ms | 71 ms | 72 ms | 82 ms | 69 ms |
| config loaded | 91 ms | 94 ms | 94 ms | 103 ms | 90 ms |
| keybindings loaded | 91 ms | 95 ms | 95 ms | 105 ms | 93 ms |
| session state loaded | 91 ms | 95 ms | 95 ms | 105 ms | 93 ms |
| extensions scanned | 86 ms | 87 ms | 87 ms | 98 ms | 85 ms |
| themes ready | 94 ms | 98 ms | 98 ms | 109 ms | 96 ms |
| DI container created | 97 ms | 101 ms | 101 ms | 112 ms | 99 ms |
| workbench mounted | 138 ms | 138 ms | 139 ms | 153 ms | 136 ms |
| first frame | 138 ms | 138 ms | 139 ms | 153 ms | 136 ms |
| workbench activated | 145 ms | 148 ms | 146 ms | 160 ms | 143 ms |
| grammars preloaded | 149 ms | 153 ms | 150 ms | 167 ms | 145 ms |
| file read from disk | 152 ms | 157 ms | 165 ms | 256 ms | 155 ms |
| file decoded | 152 ms | 157 ms | 165 ms | 256 ms | 155 ms |
| document built | 152 ms | 157 ms | 165 ms | 256 ms | 155 ms |
| tokenizer attached to editor | 173 ms | 180 ms | 189 ms | 285 ms | — |
| tabs opened | 156 ms | 163 ms | 172 ms | 267 ms | 173 ms |
| built-in extensions registered | 308 ms | 315 ms | 327 ms | 406 ms | 231 ms |
| frame with file text | 172 ms | 178 ms | 187 ms | 283 ms | 188 ms |
| frame with highlighting | 278 ms | 288 ms | 297 ms | 378 ms | — |
| extension host up | 536 ms | 561 ms | 644 ms | 1103 ms | 405 ms |
| startup complete | 293 ms | 304 ms | 315 ms | 395 ms | 218 ms |
| to text (black box) | 177 ms | 179 ms | 190 ms | 284 ms | 189 ms |
| to highlight (black box) | 278 ms | 289 ms | 298 ms | 378 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 3 ms | 3 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 39 ms | 13 ms | 12 ms | 12 ms | — | 9 ms | 3 ms |
| `medium` failed | 30 ms | 15 ms | 10 ms | 12 ms | — | 7 ms | 6 ms |
| `large` failed | 38 ms | 21 ms | 28 ms | 18 ms | — | 13 ms | 22 ms |
| `xlarge` failed | 35 ms | 28 ms | 15 ms | 22 ms | — | 17 ms | 91 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
