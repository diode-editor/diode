# File open benchmark

- Recorded: 2026-11-18T09:01:10.660Z, commit `c9cad1ad0af4`, diode nightly-c9cad1a
- Machine: INTEL(R) XEON(R) PLATINUM 8573C (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 26 ms; binary floor (`diode --version` over PTY, median): 72 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **163 ms** | 117 ms | 189 ms | 307 ms | 11 ms | 292 MB | 11 |
| `medium` | 126.7 KB | 2000 | **166 ms** | 120 ms | 192 ms | 307 ms | 7 ms | 300 MB | 11 |
| `large` | 1.3 MB | 20000 | **182 ms** | 136 ms | 208 ms | 329 ms | 8 ms | 312 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **261 ms** | 215 ms | 287 ms | 384 ms | 20 ms | 363 MB | 5 |
| `log500m` | 497 MB | 5295839 | **183 ms** | 137 ms | 209 ms | — (plaintext) | 21 ms | 336 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 6 ms | 7 ms | 7 ms | 5 ms |
| node ready (bootstrapComplete) | 74 ms | 76 ms | 78 ms | 84 ms | 75 ms |
| bundle executed (main:start) | 74 ms | 76 ms | 79 ms | 84 ms | 75 ms |
| config loaded | 99 ms | 100 ms | 101 ms | 105 ms | 94 ms |
| keybindings loaded | 100 ms | 102 ms | 104 ms | 105 ms | 97 ms |
| session state loaded | 101 ms | 102 ms | 104 ms | 105 ms | 97 ms |
| extensions scanned | 91 ms | 93 ms | 95 ms | 100 ms | 90 ms |
| themes ready | 104 ms | 105 ms | 108 ms | 110 ms | 101 ms |
| DI container created | 108 ms | 110 ms | 112 ms | 115 ms | 104 ms |
| workbench mounted | 150 ms | 152 ms | 155 ms | 156 ms | 153 ms |
| first frame | 150 ms | 152 ms | 155 ms | 156 ms | 153 ms |
| workbench activated | 158 ms | 159 ms | 163 ms | 163 ms | 161 ms |
| grammars preloaded | 163 ms | 164 ms | 168 ms | 168 ms | 164 ms |
| file read from disk | 166 ms | 168 ms | 182 ms | 258 ms | 174 ms |
| file decoded | 166 ms | 168 ms | 183 ms | 258 ms | 174 ms |
| document built | 166 ms | 168 ms | 183 ms | 259 ms | 174 ms |
| tokenizer attached to editor | 188 ms | 193 ms | 209 ms | 287 ms | — |
| tabs opened | 171 ms | 174 ms | 191 ms | 268 ms | 192 ms |
| built-in extensions registered | 336 ms | 339 ms | 357 ms | 412 ms | 257 ms |
| frame with file text | 187 ms | 191 ms | 207 ms | 284 ms | 208 ms |
| frame with highlighting | 307 ms | 307 ms | 328 ms | 384 ms | — |
| extension host up | 575 ms | 612 ms | 699 ms | 1126 ms | 469 ms |
| startup complete | 323 ms | 325 ms | 345 ms | 400 ms | 238 ms |
| to text (black box) | 189 ms | 192 ms | 208 ms | 287 ms | 209 ms |
| to highlight (black box) | 307 ms | 307 ms | 329 ms | 384 ms | — |
| gap black − white (text) | 3 ms | 1 ms | 2 ms | 2 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 37 ms | 19 ms | 15 ms | 12 ms | — | 6 ms | 4 ms |
| `medium` failed | 40 ms | 15 ms | 9 ms | 12 ms | — | 7 ms | 7 ms |
| `large` failed | 29 ms | 22 ms | 19 ms | 19 ms | — | 26 ms | 22 ms |
| `xlarge` failed | 33 ms | 41 ms | 22 ms | 27 ms | — | 13 ms | 78 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
