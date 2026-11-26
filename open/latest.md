# File open benchmark

- Recorded: 2026-11-26T11:07:34.539Z, commit `1ebeb913e6e8`, diode nightly-1ebeb91
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1020-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 75 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **172 ms** | 123 ms | 198 ms | 321 ms | 4 ms | 295 MB | 11 |
| `medium` | 126.7 KB | 2000 | **183 ms** | 133 ms | 208 ms | 329 ms | 18 ms | 303 MB | 11 |
| `large` | 1.3 MB | 20000 | **195 ms** | 146 ms | 220 ms | 341 ms | 4 ms | 314 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **309 ms** | 260 ms | 334 ms | 438 ms | 1 ms | 364 MB | 5 |
| `log500m` | 497 MB | 5295839 | **204 ms** | 155 ms | 230 ms | — (plaintext) | 4 ms | 335 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 8 ms | 9 ms | 7 ms |
| node ready (bootstrapComplete) | 77 ms | 80 ms | 82 ms | 108 ms | 79 ms |
| bundle executed (main:start) | 77 ms | 80 ms | 82 ms | 108 ms | 79 ms |
| config loaded | 102 ms | 101 ms | 105 ms | 132 ms | 106 ms |
| keybindings loaded | 103 ms | 101 ms | 105 ms | 132 ms | 107 ms |
| session state loaded | 103 ms | 101 ms | 105 ms | 132 ms | 107 ms |
| extensions scanned | 98 ms | 96 ms | 97 ms | 124 ms | 95 ms |
| themes ready | 107 ms | 109 ms | 113 ms | 139 ms | 111 ms |
| DI container created | 111 ms | 113 ms | 117 ms | 144 ms | 115 ms |
| workbench mounted | 159 ms | 167 ms | 164 ms | 193 ms | 162 ms |
| first frame | 159 ms | 167 ms | 164 ms | 193 ms | 162 ms |
| workbench activated | 167 ms | 174 ms | 171 ms | 200 ms | 170 ms |
| grammars preloaded | 173 ms | 180 ms | 177 ms | 206 ms | 174 ms |
| file read from disk | 175 ms | 184 ms | 190 ms | 304 ms | 189 ms |
| file decoded | 176 ms | 184 ms | 190 ms | 304 ms | 189 ms |
| document built | 176 ms | 184 ms | 190 ms | 304 ms | 189 ms |
| tokenizer attached to editor | 199 ms | 209 ms | 220 ms | 337 ms | — |
| tabs opened | 181 ms | 192 ms | 200 ms | 315 ms | 212 ms |
| built-in extensions registered | 359 ms | 363 ms | 375 ms | 473 ms | 287 ms |
| frame with file text | 198 ms | 207 ms | 218 ms | 334 ms | 229 ms |
| frame with highlighting | 320 ms | 329 ms | 341 ms | 438 ms | — |
| extension host up | 606 ms | 672 ms | 727 ms | 1211 ms | 483 ms |
| startup complete | 347 ms | 351 ms | 363 ms | 460 ms | 271 ms |
| to text (black box) | 198 ms | 208 ms | 220 ms | 334 ms | 230 ms |
| to highlight (black box) | 321 ms | 329 ms | 341 ms | 438 ms | — |
| gap black − white (text) | 2 ms | 1 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 32 ms | 13 ms | 11 ms | 11 ms | — | 10 ms | 4 ms |
| `medium` failed | 32 ms | 19 ms | 15 ms | 14 ms | — | 10 ms | 10 ms |
| `large` failed | 43 ms | 24 ms | 23 ms | 26 ms | — | 18 ms | 16 ms |
| `xlarge` failed | 33 ms | 30 ms | 18 ms | 26 ms | — | 19 ms | 83 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
