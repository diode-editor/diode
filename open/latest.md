# File open benchmark

- Recorded: 2026-11-09T04:30:14.137Z, commit `dc97cec68ec4`, diode nightly-dc97cec
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 23 ms; binary floor (`diode --version` over PTY, median): 64 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **160 ms** | 119 ms | 183 ms | 290 ms | 16 ms | 281 MB | 11 |
| `medium` | 126.7 KB | 2000 | **157 ms** | 116 ms | 181 ms | 294 ms | 8 ms | 287 MB | 11 |
| `large` | 1.3 MB | 20000 | **172 ms** | 131 ms | 196 ms | 308 ms | 8 ms | 298 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **267 ms** | 226 ms | 290 ms | 385 ms | 6 ms | 354 MB | 5 |
| `log500m` | 497 MB | 5295839 | **173 ms** | 132 ms | 197 ms | — (plaintext) | 4 ms | 307 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 7 ms | 8 ms | 5 ms |
| node ready (bootstrapComplete) | 73 ms | 70 ms | 75 ms | 89 ms | 66 ms |
| bundle executed (main:start) | 73 ms | 70 ms | 75 ms | 89 ms | 66 ms |
| config loaded | 95 ms | 92 ms | 96 ms | 110 ms | 83 ms |
| keybindings loaded | 96 ms | 92 ms | 98 ms | 111 ms | 83 ms |
| session state loaded | 96 ms | 92 ms | 99 ms | 111 ms | 83 ms |
| extensions scanned | 90 ms | 89 ms | 92 ms | 107 ms | 78 ms |
| themes ready | 99 ms | 97 ms | 102 ms | 114 ms | 91 ms |
| DI container created | 103 ms | 101 ms | 105 ms | 118 ms | 96 ms |
| workbench mounted | 145 ms | 139 ms | 141 ms | 157 ms | 139 ms |
| first frame | 145 ms | 139 ms | 141 ms | 157 ms | 139 ms |
| workbench activated | 153 ms | 147 ms | 147 ms | 164 ms | 146 ms |
| grammars preloaded | 160 ms | 154 ms | 153 ms | 169 ms | 148 ms |
| file read from disk | 162 ms | 158 ms | 168 ms | 262 ms | 161 ms |
| file decoded | 163 ms | 158 ms | 168 ms | 262 ms | 161 ms |
| document built | 163 ms | 158 ms | 168 ms | 263 ms | 162 ms |
| tokenizer attached to editor | 184 ms | 183 ms | 197 ms | 291 ms | — |
| tabs opened | 167 ms | 164 ms | 177 ms | 273 ms | 183 ms |
| built-in extensions registered | 321 ms | 324 ms | 336 ms | 413 ms | 242 ms |
| frame with file text | 183 ms | 180 ms | 195 ms | 289 ms | 196 ms |
| frame with highlighting | 290 ms | 294 ms | 308 ms | 385 ms | — |
| extension host up | 577 ms | 611 ms | 690 ms | 1101 ms | 448 ms |
| startup complete | 312 ms | 313 ms | 326 ms | 403 ms | 231 ms |
| to text (black box) | 183 ms | 181 ms | 196 ms | 290 ms | 197 ms |
| to highlight (black box) | 290 ms | 294 ms | 308 ms | 385 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 2 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 36 ms | 13 ms | 15 ms | 15 ms | — | 9 ms | 3 ms |
| `medium` failed | 33 ms | 13 ms | 12 ms | 8 ms | — | 6 ms | 9 ms |
| `large` failed | 36 ms | 20 ms | 21 ms | 15 ms | — | 17 ms | 19 ms |
| `xlarge` failed | 29 ms | 44 ms | 20 ms | 60 ms | — | 25 ms | 85 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
