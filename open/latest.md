# File open benchmark

- Recorded: 2026-10-28T07:53:02.489Z, commit `423efd925f43`, diode nightly-423efd9
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 27 ms; binary floor (`diode --version` over PTY, median): 65 ms; for reference `node --version`: 5 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **151 ms** | 113 ms | 178 ms | 299 ms | 10 ms | 253 MB | 11 |
| `medium` | 126.7 KB | 2000 | **154 ms** | 116 ms | 180 ms | 302 ms | 10 ms | 281 MB | 11 |
| `large` | 1.3 MB | 20000 | **157 ms** | 119 ms | 184 ms | 319 ms | 7 ms | 295 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **250 ms** | 213 ms | 277 ms | 404 ms | 13 ms | 363 MB | 5 |
| `log500m` | 497 MB | 5295839 | **160 ms** | 122 ms | 187 ms | — (plaintext) | 11 ms | 270 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 8 ms | 9 ms | 6 ms |
| node ready (bootstrapComplete) | 69 ms | 69 ms | 71 ms | 73 ms | 65 ms |
| bundle executed (main:start) | 70 ms | 69 ms | 71 ms | 73 ms | 65 ms |
| config loaded | 87 ms | 88 ms | 89 ms | 93 ms | 82 ms |
| keybindings loaded | 87 ms | 90 ms | 90 ms | 93 ms | 84 ms |
| session state loaded | 87 ms | 90 ms | 90 ms | 93 ms | 84 ms |
| extensions scanned | 83 ms | 85 ms | 84 ms | 89 ms | 79 ms |
| themes ready | 93 ms | 93 ms | 94 ms | 97 ms | 88 ms |
| DI container created | 99 ms | 97 ms | 101 ms | 101 ms | 93 ms |
| workbench mounted | 134 ms | 131 ms | 131 ms | 134 ms | 128 ms |
| first frame | 134 ms | 131 ms | 131 ms | 134 ms | 128 ms |
| workbench activated | 144 ms | 140 ms | 139 ms | 141 ms | 137 ms |
| grammars preloaded | 150 ms | 148 ms | 144 ms | 151 ms | 141 ms |
| file read from disk | 153 ms | 152 ms | 158 ms | 249 ms | 152 ms |
| file decoded | 153 ms | 152 ms | 158 ms | 249 ms | 152 ms |
| document built | 154 ms | 152 ms | 159 ms | 250 ms | 152 ms |
| tokenizer attached to editor | 177 ms | 185 ms | 200 ms | 293 ms | — |
| tabs opened | 158 ms | 160 ms | 168 ms | 261 ms | 172 ms |
| built-in extensions registered | 321 ms | 324 ms | 337 ms | 424 ms | 228 ms |
| frame with file text | 175 ms | 176 ms | 184 ms | 275 ms | 187 ms |
| frame with highlighting | 298 ms | 302 ms | 318 ms | 404 ms | — |
| extension host up | 568 ms | 606 ms | 656 ms | 1104 ms | 443 ms |
| startup complete | 314 ms | 318 ms | 331 ms | 418 ms | 220 ms |
| to text (black box) | 178 ms | 180 ms | 184 ms | 277 ms | 187 ms |
| to highlight (black box) | 299 ms | 302 ms | 319 ms | 404 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 1 ms | 2 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 39 ms | 15 ms | 13 ms | 9 ms | 14 ms | 10 ms | 5 ms |
| `medium` | 29 ms | 13 ms | 12 ms | 9 ms | 22 ms | 8 ms | 5 ms |
| `large` | 33 ms | 21 ms | 21 ms | 19 ms | 40 ms | 13 ms | 14 ms |
| `xlarge` | 30 ms | 21 ms | 9 ms | 12 ms | 95 ms | 8 ms | 83 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
