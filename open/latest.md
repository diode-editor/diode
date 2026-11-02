# File open benchmark

- Recorded: 2026-11-02T09:38:46.470Z, commit `3bb988d0abfb`, diode nightly-3bb988d
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 64 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **149 ms** | 110 ms | 174 ms | 290 ms | 3 ms | 257 MB | 11 |
| `medium` | 126.7 KB | 2000 | **152 ms** | 113 ms | 178 ms | 300 ms | 7 ms | 282 MB | 11 |
| `large` | 1.3 MB | 20000 | **160 ms** | 121 ms | 185 ms | 326 ms | 10 ms | 290 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **267 ms** | 228 ms | 292 ms | 417 ms | 38 ms | 364 MB | 5 |
| `log500m` | 497 MB | 5295839 | **165 ms** | 127 ms | 191 ms | — (plaintext) | 7 ms | 273 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 8 ms | 8 ms | 5 ms |
| node ready (bootstrapComplete) | 70 ms | 69 ms | 70 ms | 87 ms | 63 ms |
| bundle executed (main:start) | 70 ms | 70 ms | 70 ms | 87 ms | 63 ms |
| config loaded | 88 ms | 89 ms | 91 ms | 107 ms | 84 ms |
| keybindings loaded | 89 ms | 90 ms | 91 ms | 107 ms | 85 ms |
| session state loaded | 89 ms | 90 ms | 91 ms | 108 ms | 85 ms |
| extensions scanned | 84 ms | 85 ms | 87 ms | 102 ms | 79 ms |
| themes ready | 94 ms | 95 ms | 95 ms | 112 ms | 89 ms |
| DI container created | 98 ms | 100 ms | 99 ms | 117 ms | 93 ms |
| workbench mounted | 134 ms | 135 ms | 133 ms | 155 ms | 130 ms |
| first frame | 134 ms | 135 ms | 133 ms | 154 ms | 130 ms |
| workbench activated | 145 ms | 144 ms | 138 ms | 165 ms | 140 ms |
| grammars preloaded | 150 ms | 150 ms | 145 ms | 170 ms | 142 ms |
| file read from disk | 152 ms | 154 ms | 161 ms | 270 ms | 154 ms |
| file decoded | 152 ms | 154 ms | 161 ms | 270 ms | 154 ms |
| document built | 152 ms | 154 ms | 161 ms | 270 ms | 154 ms |
| tokenizer attached to editor | 175 ms | 185 ms | 202 ms | 309 ms | — |
| tabs opened | 157 ms | 161 ms | 171 ms | 279 ms | 175 ms |
| built-in extensions registered | 317 ms | 330 ms | 350 ms | 440 ms | 234 ms |
| frame with file text | 173 ms | 177 ms | 185 ms | 292 ms | 191 ms |
| frame with highlighting | 289 ms | 300 ms | 326 ms | 417 ms | — |
| extension host up | 567 ms | 614 ms | 677 ms | 1139 ms | 432 ms |
| startup complete | 310 ms | 324 ms | 344 ms | 434 ms | 226 ms |
| to text (black box) | 174 ms | 178 ms | 185 ms | 292 ms | 191 ms |
| to highlight (black box) | 290 ms | 300 ms | 326 ms | 417 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 33 ms | 14 ms | 11 ms | 9 ms | 22 ms | 8 ms | 4 ms |
| `medium` | 37 ms | 16 ms | 11 ms | 11 ms | 18 ms | 10 ms | 5 ms |
| `large` | 48 ms | 27 ms | 21 ms | 23 ms | 47 ms | 16 ms | 19 ms |
| `xlarge` | 28 ms | 33 ms | 21 ms | 24 ms | 146 ms | 18 ms | 77 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
