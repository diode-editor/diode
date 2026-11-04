# File open benchmark

- Recorded: 2026-11-04T07:26:13.774Z, commit `b66671fc872c`, diode nightly-b66671f
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 66 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **150 ms** | 109 ms | 175 ms | 293 ms | 14 ms | 268 MB | 11 |
| `medium` | 126.7 KB | 2000 | **152 ms** | 111 ms | 177 ms | 296 ms | 9 ms | 282 MB | 11 |
| `large` | 1.3 MB | 20000 | **173 ms** | 132 ms | 198 ms | 316 ms | 3 ms | 291 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **262 ms** | 222 ms | 288 ms | 391 ms | 9 ms | 344 MB | 5 |
| `log500m` | 497 MB | 5295839 | **171 ms** | 130 ms | 196 ms | — (plaintext) | 6 ms | 273 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 6 ms | 8 ms | 12 ms | 6 ms |
| node ready (bootstrapComplete) | 71 ms | 71 ms | 76 ms | 83 ms | 65 ms |
| bundle executed (main:start) | 71 ms | 71 ms | 76 ms | 83 ms | 65 ms |
| config loaded | 92 ms | 95 ms | 93 ms | 106 ms | 85 ms |
| keybindings loaded | 93 ms | 96 ms | 93 ms | 106 ms | 85 ms |
| session state loaded | 93 ms | 96 ms | 93 ms | 107 ms | 85 ms |
| extensions scanned | 89 ms | 89 ms | 89 ms | 103 ms | 80 ms |
| themes ready | 97 ms | 99 ms | 99 ms | 110 ms | 91 ms |
| DI container created | 101 ms | 103 ms | 104 ms | 113 ms | 95 ms |
| workbench mounted | 138 ms | 136 ms | 144 ms | 150 ms | 132 ms |
| first frame | 138 ms | 135 ms | 144 ms | 150 ms | 132 ms |
| workbench activated | 143 ms | 141 ms | 151 ms | 161 ms | 142 ms |
| grammars preloaded | 150 ms | 147 ms | 157 ms | 166 ms | 144 ms |
| file read from disk | 152 ms | 151 ms | 171 ms | 258 ms | 156 ms |
| file decoded | 153 ms | 151 ms | 171 ms | 258 ms | 156 ms |
| document built | 153 ms | 151 ms | 171 ms | 258 ms | 157 ms |
| tokenizer attached to editor | 176 ms | 177 ms | 198 ms | 287 ms | — |
| tabs opened | 158 ms | 158 ms | 182 ms | 269 ms | 178 ms |
| built-in extensions registered | 318 ms | 320 ms | 340 ms | 415 ms | 238 ms |
| frame with file text | 175 ms | 175 ms | 197 ms | 285 ms | 195 ms |
| frame with highlighting | 293 ms | 296 ms | 315 ms | 391 ms | — |
| extension host up | 571 ms | 621 ms | 697 ms | 1134 ms | 424 ms |
| startup complete | 311 ms | 313 ms | 333 ms | 409 ms | 230 ms |
| to text (black box) | 175 ms | 177 ms | 198 ms | 288 ms | 196 ms |
| to highlight (black box) | 293 ms | 296 ms | 316 ms | 391 ms | — |
| gap black − white (text) | 2 ms | 1 ms | 2 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 40 ms | 17 ms | 11 ms | 13 ms | — | 8 ms | 5 ms |
| `medium` failed | 40 ms | 16 ms | 13 ms | 13 ms | — | 8 ms | 5 ms |
| `large` failed | 37 ms | 28 ms | 27 ms | 18 ms | — | 16 ms | 21 ms |
| `xlarge` failed | 36 ms | 33 ms | 19 ms | 24 ms | — | 13 ms | 82 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
