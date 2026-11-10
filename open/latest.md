# File open benchmark

- Recorded: 2026-11-10T00:27:50.720Z, commit `b3d646dde540`, diode nightly-b3d646d
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 27 ms; binary floor (`diode --version` over PTY, median): 65 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **151 ms** | 113 ms | 178 ms | 297 ms | 10 ms | 278 MB | 11 |
| `medium` | 126.7 KB | 2000 | **155 ms** | 117 ms | 182 ms | 295 ms | 3 ms | 288 MB | 11 |
| `large` | 1.3 MB | 20000 | **172 ms** | 134 ms | 199 ms | 320 ms | 9 ms | 299 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **264 ms** | 225 ms | 290 ms | 387 ms | 7 ms | 353 MB | 5 |
| `log500m` | 497 MB | 5295839 | **182 ms** | 144 ms | 209 ms | — (plaintext) | 11 ms | 307 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 6 ms | 7 ms | 10 ms | 6 ms |
| node ready (bootstrapComplete) | 68 ms | 71 ms | 73 ms | 83 ms | 67 ms |
| bundle executed (main:start) | 68 ms | 71 ms | 73 ms | 83 ms | 67 ms |
| config loaded | 89 ms | 92 ms | 93 ms | 107 ms | 91 ms |
| keybindings loaded | 89 ms | 93 ms | 93 ms | 108 ms | 91 ms |
| session state loaded | 89 ms | 93 ms | 93 ms | 108 ms | 92 ms |
| extensions scanned | 83 ms | 87 ms | 88 ms | 105 ms | 88 ms |
| themes ready | 94 ms | 96 ms | 97 ms | 111 ms | 95 ms |
| DI container created | 99 ms | 99 ms | 102 ms | 114 ms | 98 ms |
| workbench mounted | 142 ms | 139 ms | 149 ms | 155 ms | 145 ms |
| first frame | 142 ms | 139 ms | 149 ms | 155 ms | 145 ms |
| workbench activated | 148 ms | 147 ms | 156 ms | 162 ms | 153 ms |
| grammars preloaded | 154 ms | 152 ms | 162 ms | 168 ms | 155 ms |
| file read from disk | 157 ms | 156 ms | 173 ms | 260 ms | 171 ms |
| file decoded | 157 ms | 156 ms | 173 ms | 260 ms | 171 ms |
| document built | 157 ms | 156 ms | 174 ms | 261 ms | 171 ms |
| tokenizer attached to editor | 178 ms | 183 ms | 199 ms | 292 ms | — |
| tabs opened | 162 ms | 163 ms | 183 ms | 271 ms | 191 ms |
| built-in extensions registered | 325 ms | 326 ms | 348 ms | 416 ms | 253 ms |
| frame with file text | 177 ms | 180 ms | 196 ms | 289 ms | 209 ms |
| frame with highlighting | 297 ms | 295 ms | 320 ms | 387 ms | — |
| extension host up | 570 ms | 620 ms | 684 ms | 1124 ms | 456 ms |
| startup complete | 315 ms | 317 ms | 339 ms | 406 ms | 242 ms |
| to text (black box) | 178 ms | 182 ms | 199 ms | 290 ms | 209 ms |
| to highlight (black box) | 297 ms | 295 ms | 320 ms | 387 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 1 ms | 2 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 42 ms | 15 ms | 13 ms | 13 ms | — | 9 ms | 3 ms |
| `medium` failed | 31 ms | 15 ms | 12 ms | 10 ms | — | 8 ms | 9 ms |
| `large` failed | 30 ms | 21 ms | 20 ms | 20 ms | — | 15 ms | 19 ms |
| `xlarge` failed | 28 ms | 42 ms | 26 ms | 51 ms | — | 22 ms | 83 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
