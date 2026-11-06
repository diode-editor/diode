# File open benchmark

- Recorded: 2026-11-06T11:52:35.059Z, commit `e797a7df659e`, diode nightly-e797a7d
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 26 ms; binary floor (`diode --version` over PTY, median): 65 ms; for reference `node --version`: 5 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **155 ms** | 116 ms | 181 ms | 294 ms | 9 ms | 268 MB | 11 |
| `medium` | 126.7 KB | 2000 | **154 ms** | 115 ms | 180 ms | 301 ms | 9 ms | 283 MB | 11 |
| `large` | 1.3 MB | 20000 | **183 ms** | 144 ms | 209 ms | 331 ms | 9 ms | 295 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **259 ms** | 220 ms | 285 ms | 389 ms | 33 ms | 351 MB | 5 |
| `log500m` | 497 MB | 5295839 | **177 ms** | 137 ms | 202 ms | — (plaintext) | 7 ms | 277 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 7 ms | 9 ms | 6 ms |
| node ready (bootstrapComplete) | 71 ms | 71 ms | 77 ms | 81 ms | 69 ms |
| bundle executed (main:start) | 71 ms | 71 ms | 77 ms | 81 ms | 69 ms |
| config loaded | 93 ms | 92 ms | 108 ms | 107 ms | 92 ms |
| keybindings loaded | 94 ms | 92 ms | 108 ms | 110 ms | 93 ms |
| session state loaded | 94 ms | 92 ms | 108 ms | 111 ms | 93 ms |
| extensions scanned | 87 ms | 87 ms | 101 ms | 103 ms | 88 ms |
| themes ready | 99 ms | 97 ms | 112 ms | 114 ms | 98 ms |
| DI container created | 102 ms | 101 ms | 115 ms | 118 ms | 101 ms |
| workbench mounted | 139 ms | 141 ms | 152 ms | 153 ms | 137 ms |
| first frame | 139 ms | 141 ms | 152 ms | 153 ms | 137 ms |
| workbench activated | 147 ms | 146 ms | 161 ms | 159 ms | 143 ms |
| grammars preloaded | 152 ms | 152 ms | 166 ms | 165 ms | 145 ms |
| file read from disk | 155 ms | 156 ms | 182 ms | 258 ms | 160 ms |
| file decoded | 155 ms | 156 ms | 182 ms | 258 ms | 160 ms |
| document built | 156 ms | 157 ms | 182 ms | 259 ms | 160 ms |
| tokenizer attached to editor | 180 ms | 179 ms | 210 ms | 286 ms | — |
| tabs opened | 160 ms | 164 ms | 192 ms | 269 ms | 182 ms |
| built-in extensions registered | 325 ms | 328 ms | 358 ms | 416 ms | 247 ms |
| frame with file text | 179 ms | 178 ms | 209 ms | 284 ms | 202 ms |
| frame with highlighting | 294 ms | 301 ms | 331 ms | 388 ms | — |
| extension host up | 580 ms | 630 ms | 750 ms | 1157 ms | 460 ms |
| startup complete | 317 ms | 319 ms | 349 ms | 406 ms | 238 ms |
| to text (black box) | 181 ms | 180 ms | 209 ms | 285 ms | 202 ms |
| to highlight (black box) | 294 ms | 301 ms | 331 ms | 389 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 36 ms | 15 ms | 13 ms | 14 ms | — | 10 ms | 4 ms |
| `medium` failed | 34 ms | 13 ms | 11 ms | 12 ms | — | 7 ms | 6 ms |
| `large` failed | 38 ms | 29 ms | 28 ms | 17 ms | — | 17 ms | 19 ms |
| `xlarge` failed | 29 ms | 42 ms | 24 ms | 59 ms | — | 24 ms | 80 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
