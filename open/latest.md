# File open benchmark

- Recorded: 2026-11-26T12:06:36.608Z, commit `a2fd1738ce18`, diode nightly-a2fd173
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1020-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 71 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **171 ms** | 125 ms | 196 ms | 308 ms | 5 ms | 294 MB | 11 |
| `medium` | 126.7 KB | 2000 | **183 ms** | 137 ms | 208 ms | 326 ms | 36 ms | 303 MB | 11 |
| `large` | 1.3 MB | 20000 | **188 ms** | 141 ms | 212 ms | 326 ms | 7 ms | 316 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **268 ms** | 221 ms | 292 ms | 397 ms | 20 ms | 364 MB | 5 |
| `log500m` | 497 MB | 5295839 | **187 ms** | 141 ms | 211 ms | — (plaintext) | 5 ms | 333 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 7 ms | 9 ms | 6 ms |
| node ready (bootstrapComplete) | 76 ms | 85 ms | 81 ms | 84 ms | 72 ms |
| bundle executed (main:start) | 76 ms | 85 ms | 81 ms | 84 ms | 72 ms |
| config loaded | 96 ms | 109 ms | 101 ms | 108 ms | 94 ms |
| keybindings loaded | 97 ms | 109 ms | 104 ms | 108 ms | 95 ms |
| session state loaded | 97 ms | 109 ms | 104 ms | 108 ms | 96 ms |
| extensions scanned | 90 ms | 101 ms | 96 ms | 105 ms | 88 ms |
| themes ready | 102 ms | 113 ms | 108 ms | 114 ms | 101 ms |
| DI container created | 106 ms | 117 ms | 112 ms | 117 ms | 105 ms |
| workbench mounted | 156 ms | 166 ms | 156 ms | 168 ms | 148 ms |
| first frame | 156 ms | 166 ms | 156 ms | 168 ms | 148 ms |
| workbench activated | 163 ms | 174 ms | 162 ms | 175 ms | 154 ms |
| grammars preloaded | 169 ms | 180 ms | 168 ms | 181 ms | 157 ms |
| file read from disk | 172 ms | 184 ms | 182 ms | 269 ms | 171 ms |
| file decoded | 172 ms | 184 ms | 182 ms | 269 ms | 171 ms |
| document built | 172 ms | 184 ms | 182 ms | 269 ms | 172 ms |
| tokenizer attached to editor | 194 ms | 209 ms | 212 ms | 294 ms | — |
| tabs opened | 177 ms | 192 ms | 191 ms | 278 ms | 194 ms |
| built-in extensions registered | 346 ms | 363 ms | 360 ms | 431 ms | 273 ms |
| frame with file text | 193 ms | 207 ms | 210 ms | 292 ms | 211 ms |
| frame with highlighting | 307 ms | 325 ms | 326 ms | 397 ms | — |
| extension host up | 602 ms | 674 ms | 701 ms | 1148 ms | 471 ms |
| startup complete | 335 ms | 351 ms | 349 ms | 420 ms | 257 ms |
| to text (black box) | 196 ms | 208 ms | 212 ms | 292 ms | 211 ms |
| to highlight (black box) | 308 ms | 326 ms | 326 ms | 397 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 3 ms | 0 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 33 ms | 14 ms | 13 ms | 14 ms | — | 9 ms | 3 ms |
| `medium` failed | 34 ms | 19 ms | 16 ms | 16 ms | — | 7 ms | 10 ms |
| `large` failed | 40 ms | 28 ms | 21 ms | 23 ms | — | 15 ms | 19 ms |
| `xlarge` failed | 26 ms | 35 ms | 18 ms | 18 ms | — | 17 ms | 88 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
