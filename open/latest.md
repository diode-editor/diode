# File open benchmark

- Recorded: 2026-11-18T11:09:55.596Z, commit `112b139f1608`, diode nightly-112b139
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 73 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **187 ms** | 139 ms | 212 ms | 328 ms | 20 ms | 295 MB | 11 |
| `medium` | 126.7 KB | 2000 | **184 ms** | 137 ms | 209 ms | 329 ms | 9 ms | 301 MB | 11 |
| `large` | 1.3 MB | 20000 | **196 ms** | 149 ms | 222 ms | 341 ms | 10 ms | 310 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **290 ms** | 243 ms | 315 ms | 416 ms | 6 ms | 363 MB | 5 |
| `log500m` | 497 MB | 5295839 | **196 ms** | 148 ms | 221 ms | — (plaintext) | 5 ms | 321 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 8 ms | 9 ms | 5 ms |
| node ready (bootstrapComplete) | 80 ms | 80 ms | 82 ms | 102 ms | 74 ms |
| bundle executed (main:start) | 80 ms | 80 ms | 82 ms | 102 ms | 74 ms |
| config loaded | 111 ms | 105 ms | 106 ms | 123 ms | 95 ms |
| keybindings loaded | 112 ms | 106 ms | 107 ms | 125 ms | 96 ms |
| session state loaded | 112 ms | 106 ms | 107 ms | 126 ms | 96 ms |
| extensions scanned | 96 ms | 96 ms | 99 ms | 117 ms | 89 ms |
| themes ready | 116 ms | 110 ms | 111 ms | 129 ms | 101 ms |
| DI container created | 120 ms | 114 ms | 116 ms | 133 ms | 106 ms |
| workbench mounted | 166 ms | 163 ms | 164 ms | 176 ms | 160 ms |
| first frame | 166 ms | 163 ms | 164 ms | 176 ms | 160 ms |
| workbench activated | 174 ms | 171 ms | 174 ms | 184 ms | 168 ms |
| grammars preloaded | 179 ms | 178 ms | 178 ms | 189 ms | 170 ms |
| file read from disk | 182 ms | 182 ms | 192 ms | 288 ms | 184 ms |
| file decoded | 182 ms | 182 ms | 192 ms | 288 ms | 184 ms |
| document built | 182 ms | 182 ms | 192 ms | 289 ms | 184 ms |
| tokenizer attached to editor | 210 ms | 211 ms | 225 ms | 317 ms | — |
| tabs opened | 188 ms | 190 ms | 202 ms | 298 ms | 203 ms |
| built-in extensions registered | 366 ms | 367 ms | 378 ms | 451 ms | 279 ms |
| frame with file text | 210 ms | 209 ms | 222 ms | 315 ms | 221 ms |
| frame with highlighting | 327 ms | 329 ms | 341 ms | 416 ms | — |
| extension host up | 646 ms | 679 ms | 748 ms | 1162 ms | 490 ms |
| startup complete | 351 ms | 352 ms | 363 ms | 439 ms | 264 ms |
| to text (black box) | 212 ms | 209 ms | 222 ms | 315 ms | 221 ms |
| to highlight (black box) | 328 ms | 329 ms | 341 ms | 416 ms | — |
| gap black − white (text) | 2 ms | 1 ms | 1 ms | 0 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 38 ms | 24 ms | 15 ms | 11 ms | — | 9 ms | 6 ms |
| `medium` failed | 34 ms | 15 ms | 13 ms | 14 ms | — | 6 ms | 10 ms |
| `large` failed | 44 ms | 24 ms | 21 ms | 23 ms | — | 15 ms | 25 ms |
| `xlarge` failed | 29 ms | 45 ms | 27 ms | 29 ms | — | 18 ms | 88 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
