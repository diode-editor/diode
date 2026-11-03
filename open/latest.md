# File open benchmark

- Recorded: 2026-11-03T15:55:56.580Z, commit `d13f455d42da`, diode nightly-d13f455
- Machine: INTEL(R) XEON(R) PLATINUM 8573C (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 64 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **147 ms** | 108 ms | 172 ms | 290 ms | 7 ms | 256 MB | 11 |
| `medium` | 126.7 KB | 2000 | **148 ms** | 109 ms | 173 ms | 289 ms | 6 ms | 282 MB | 11 |
| `large` | 1.3 MB | 20000 | **166 ms** | 127 ms | 191 ms | 313 ms | 13 ms | 295 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **248 ms** | 209 ms | 273 ms | 381 ms | 6 ms | 346 MB | 5 |
| `log500m` | 497 MB | 5295839 | **158 ms** | 119 ms | 183 ms | — (plaintext) | 3 ms | 273 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 7 ms | 8 ms | 5 ms |
| node ready (bootstrapComplete) | 70 ms | 69 ms | 74 ms | 77 ms | 65 ms |
| bundle executed (main:start) | 70 ms | 69 ms | 74 ms | 77 ms | 65 ms |
| config loaded | 88 ms | 88 ms | 92 ms | 95 ms | 82 ms |
| keybindings loaded | 88 ms | 88 ms | 93 ms | 96 ms | 82 ms |
| session state loaded | 88 ms | 88 ms | 93 ms | 96 ms | 82 ms |
| extensions scanned | 85 ms | 83 ms | 88 ms | 91 ms | 78 ms |
| themes ready | 94 ms | 92 ms | 97 ms | 101 ms | 86 ms |
| DI container created | 98 ms | 96 ms | 101 ms | 105 ms | 91 ms |
| workbench mounted | 132 ms | 128 ms | 135 ms | 135 ms | 125 ms |
| first frame | 132 ms | 128 ms | 135 ms | 135 ms | 124 ms |
| workbench activated | 138 ms | 134 ms | 141 ms | 140 ms | 130 ms |
| grammars preloaded | 148 ms | 143 ms | 152 ms | 151 ms | 138 ms |
| file read from disk | 150 ms | 147 ms | 165 ms | 248 ms | 149 ms |
| file decoded | 150 ms | 147 ms | 165 ms | 248 ms | 149 ms |
| document built | 151 ms | 147 ms | 165 ms | 249 ms | 149 ms |
| tokenizer attached to editor | 171 ms | 173 ms | 193 ms | 275 ms | — |
| tabs opened | 155 ms | 154 ms | 174 ms | 259 ms | 167 ms |
| built-in extensions registered | 311 ms | 310 ms | 332 ms | 400 ms | 222 ms |
| frame with file text | 170 ms | 171 ms | 190 ms | 273 ms | 182 ms |
| frame with highlighting | 290 ms | 288 ms | 313 ms | 381 ms | — |
| extension host up | 555 ms | 568 ms | 638 ms | 1093 ms | 408 ms |
| startup complete | 303 ms | 303 ms | 325 ms | 393 ms | 215 ms |
| to text (black box) | 172 ms | 173 ms | 191 ms | 273 ms | 183 ms |
| to highlight (black box) | 290 ms | 289 ms | 313 ms | 381 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 2 ms | 2 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 30 ms | 13 ms | 11 ms | 8 ms | — | 9 ms | 4 ms |
| `medium` failed | 36 ms | 17 ms | 13 ms | 11 ms | — | 8 ms | 6 ms |
| `large` failed | 45 ms | 29 ms | 19 ms | 26 ms | — | 17 ms | 20 ms |
| `xlarge` failed | 34 ms | 35 ms | 22 ms | 24 ms | — | 17 ms | 79 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
