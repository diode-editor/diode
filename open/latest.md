# File open benchmark

- Recorded: 2026-11-04T22:06:35.163Z, commit `4b7d4aa16bb4`, diode nightly-4b7d4aa
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 22 ms; binary floor (`diode --version` over PTY, median): 63 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **148 ms** | 107 ms | 170 ms | 282 ms | 11 ms | 275 MB | 11 |
| `medium` | 126.7 KB | 2000 | **151 ms** | 111 ms | 174 ms | 294 ms | 9 ms | 281 MB | 11 |
| `large` | 1.3 MB | 20000 | **175 ms** | 134 ms | 198 ms | 311 ms | 26 ms | 294 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **250 ms** | 209 ms | 272 ms | 373 ms | 14 ms | 344 MB | 5 |
| `log500m` | 497 MB | 5295839 | **171 ms** | 131 ms | 194 ms | — (plaintext) | 12 ms | 274 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 8 ms | 8 ms | 6 ms |
| node ready (bootstrapComplete) | 70 ms | 69 ms | 77 ms | 83 ms | 66 ms |
| bundle executed (main:start) | 70 ms | 69 ms | 77 ms | 83 ms | 66 ms |
| config loaded | 90 ms | 91 ms | 97 ms | 100 ms | 85 ms |
| keybindings loaded | 91 ms | 92 ms | 97 ms | 100 ms | 86 ms |
| session state loaded | 91 ms | 92 ms | 97 ms | 100 ms | 86 ms |
| extensions scanned | 85 ms | 87 ms | 92 ms | 95 ms | 83 ms |
| themes ready | 96 ms | 96 ms | 102 ms | 108 ms | 92 ms |
| DI container created | 100 ms | 99 ms | 107 ms | 112 ms | 95 ms |
| workbench mounted | 132 ms | 133 ms | 145 ms | 147 ms | 131 ms |
| first frame | 132 ms | 133 ms | 145 ms | 147 ms | 131 ms |
| workbench activated | 140 ms | 138 ms | 155 ms | 158 ms | 143 ms |
| grammars preloaded | 145 ms | 146 ms | 160 ms | 163 ms | 145 ms |
| file read from disk | 148 ms | 151 ms | 172 ms | 248 ms | 158 ms |
| file decoded | 148 ms | 151 ms | 172 ms | 248 ms | 158 ms |
| document built | 148 ms | 151 ms | 172 ms | 249 ms | 158 ms |
| tokenizer attached to editor | 171 ms | 174 ms | 198 ms | 275 ms | — |
| tabs opened | 152 ms | 158 ms | 183 ms | 259 ms | 178 ms |
| built-in extensions registered | 310 ms | 323 ms | 338 ms | 401 ms | 240 ms |
| frame with file text | 169 ms | 173 ms | 197 ms | 272 ms | 194 ms |
| frame with highlighting | 282 ms | 294 ms | 310 ms | 373 ms | — |
| extension host up | 573 ms | 625 ms | 701 ms | 1122 ms | 447 ms |
| startup complete | 302 ms | 313 ms | 329 ms | 390 ms | 230 ms |
| to text (black box) | 170 ms | 174 ms | 198 ms | 272 ms | 194 ms |
| to highlight (black box) | 282 ms | 294 ms | 311 ms | 373 ms | — |
| gap black − white (text) | 2 ms | 1 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 36 ms | 14 ms | 12 ms | 12 ms | — | 8 ms | 5 ms |
| `medium` failed | 37 ms | 16 ms | 11 ms | 12 ms | — | 7 ms | 8 ms |
| `large` failed | 44 ms | 37 ms | 23 ms | 24 ms | — | 19 ms | 19 ms |
| `xlarge` failed | 34 ms | 44 ms | 25 ms | 59 ms | — | 25 ms | 85 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
