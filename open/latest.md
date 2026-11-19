# File open benchmark

- Recorded: 2026-11-19T04:11:44.375Z, commit `00b1c232eeae`, diode nightly-00b1c23
- Machine: AMD EPYC 9V45 96-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 33 ms; binary floor (`diode --version` over PTY, median): 68 ms; for reference `node --version`: 6 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **148 ms** | 114 ms | 182 ms | 272 ms | 15 ms | 283 MB | 11 |
| `medium` | 126.7 KB | 2000 | **145 ms** | 110 ms | 178 ms | 269 ms | 16 ms | 302 MB | 11 |
| `large` | 1.3 MB | 20000 | **147 ms** | 112 ms | 180 ms | 259 ms | 15 ms | 317 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **219 ms** | 185 ms | 252 ms | 330 ms | 5 ms | 369 MB | 5 |
| `log500m` | 497 MB | 5295839 | **158 ms** | 124 ms | 191 ms | — (plaintext) | 15 ms | 295 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 8 ms | 6 ms | 8 ms | 6 ms |
| node ready (bootstrapComplete) | 63 ms | 63 ms | 65 ms | 75 ms | 68 ms |
| bundle executed (main:start) | 63 ms | 63 ms | 65 ms | 75 ms | 68 ms |
| config loaded | 91 ms | 86 ms | 80 ms | 101 ms | 94 ms |
| keybindings loaded | 91 ms | 88 ms | 80 ms | 102 ms | 94 ms |
| session state loaded | 91 ms | 88 ms | 80 ms | 102 ms | 94 ms |
| extensions scanned | 82 ms | 80 ms | 75 ms | 94 ms | 88 ms |
| themes ready | 95 ms | 92 ms | 86 ms | 108 ms | 99 ms |
| DI container created | 99 ms | 95 ms | 90 ms | 115 ms | 103 ms |
| workbench mounted | 143 ms | 127 ms | 138 ms | 151 ms | 135 ms |
| first frame | 143 ms | 127 ms | 138 ms | 151 ms | 135 ms |
| workbench activated | 149 ms | 142 ms | 143 ms | 157 ms | 142 ms |
| grammars preloaded | 158 ms | 148 ms | 148 ms | 163 ms | 149 ms |
| file read from disk | 160 ms | 150 ms | 156 ms | 230 ms | 160 ms |
| file decoded | 160 ms | 150 ms | 156 ms | 230 ms | 160 ms |
| document built | 161 ms | 151 ms | 156 ms | 230 ms | 161 ms |
| tokenizer attached to editor | 178 ms | 177 ms | 180 ms | 252 ms | — |
| tabs opened | 166 ms | 160 ms | 165 ms | 238 ms | 178 ms |
| built-in extensions registered | 301 ms | 294 ms | 287 ms | 361 ms | 230 ms |
| frame with file text | 177 ms | 176 ms | 178 ms | 251 ms | 191 ms |
| frame with highlighting | 273 ms | 270 ms | 258 ms | 329 ms | — |
| extension host up | 542 ms | 535 ms | 591 ms | 980 ms | 380 ms |
| startup complete | 291 ms | 285 ms | 277 ms | 352 ms | 219 ms |
| to text (black box) | 182 ms | 178 ms | 180 ms | 252 ms | 191 ms |
| to highlight (black box) | 272 ms | 269 ms | 259 ms | 330 ms | — |
| gap black − white (text) | 2 ms | 1 ms | 1 ms | 2 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 31 ms | 12 ms | 6 ms | 8 ms | — | 6 ms | 4 ms |
| `medium` failed | 26 ms | 14 ms | 9 ms | 12 ms | — | 4 ms | 6 ms |
| `large` failed | 30 ms | 19 ms | 20 ms | 17 ms | — | 22 ms | 14 ms |
| `xlarge` failed | 30 ms | 19 ms | 13 ms | 17 ms | — | 9 ms | 51 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
