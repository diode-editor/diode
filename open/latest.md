# File open benchmark

- Recorded: 2026-11-08T09:54:35.430Z, commit `c58f3c0555a9`, diode nightly-c58f3c0
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 23 ms; binary floor (`diode --version` over PTY, median): 65 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **160 ms** | 119 ms | 183 ms | 301 ms | 8 ms | 276 MB | 11 |
| `medium` | 126.7 KB | 2000 | **163 ms** | 122 ms | 187 ms | 302 ms | 4 ms | 286 MB | 11 |
| `large` | 1.3 MB | 20000 | **181 ms** | 140 ms | 204 ms | 318 ms | 12 ms | 298 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **261 ms** | 220 ms | 285 ms | 386 ms | 11 ms | 351 MB | 5 |
| `log500m` | 497 MB | 5295839 | **175 ms** | 134 ms | 198 ms | — (plaintext) | 3 ms | 308 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 6 ms | 9 ms | 9 ms | 5 ms |
| node ready (bootstrapComplete) | 71 ms | 72 ms | 77 ms | 89 ms | 66 ms |
| bundle executed (main:start) | 71 ms | 72 ms | 77 ms | 89 ms | 66 ms |
| config loaded | 90 ms | 89 ms | 96 ms | 106 ms | 85 ms |
| keybindings loaded | 91 ms | 89 ms | 96 ms | 107 ms | 85 ms |
| session state loaded | 91 ms | 89 ms | 96 ms | 107 ms | 85 ms |
| extensions scanned | 86 ms | 85 ms | 92 ms | 102 ms | 80 ms |
| themes ready | 95 ms | 95 ms | 101 ms | 112 ms | 90 ms |
| DI container created | 100 ms | 99 ms | 106 ms | 116 ms | 95 ms |
| workbench mounted | 146 ms | 146 ms | 153 ms | 157 ms | 142 ms |
| first frame | 146 ms | 146 ms | 153 ms | 157 ms | 142 ms |
| workbench activated | 153 ms | 152 ms | 160 ms | 164 ms | 148 ms |
| grammars preloaded | 159 ms | 158 ms | 166 ms | 170 ms | 150 ms |
| file read from disk | 161 ms | 163 ms | 179 ms | 254 ms | 163 ms |
| file decoded | 161 ms | 163 ms | 179 ms | 254 ms | 163 ms |
| document built | 161 ms | 163 ms | 180 ms | 255 ms | 163 ms |
| tokenizer attached to editor | 182 ms | 187 ms | 206 ms | 286 ms | — |
| tabs opened | 166 ms | 170 ms | 190 ms | 266 ms | 184 ms |
| built-in extensions registered | 329 ms | 329 ms | 345 ms | 415 ms | 245 ms |
| frame with file text | 181 ms | 185 ms | 204 ms | 284 ms | 198 ms |
| frame with highlighting | 301 ms | 301 ms | 317 ms | 386 ms | — |
| extension host up | 579 ms | 616 ms | 686 ms | 1117 ms | 441 ms |
| startup complete | 319 ms | 319 ms | 336 ms | 404 ms | 235 ms |
| to text (black box) | 183 ms | 187 ms | 204 ms | 285 ms | 198 ms |
| to highlight (black box) | 301 ms | 302 ms | 318 ms | 386 ms | — |
| gap black − white (text) | 2 ms | 1 ms | 0 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 37 ms | 13 ms | 10 ms | 11 ms | — | 8 ms | 5 ms |
| `medium` failed | 33 ms | 13 ms | 13 ms | 10 ms | — | 6 ms | 8 ms |
| `large` failed | 41 ms | 28 ms | 21 ms | 28 ms | — | 22 ms | 19 ms |
| `xlarge` failed | 29 ms | 40 ms | 23 ms | 85 ms | — | 23 ms | 81 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
