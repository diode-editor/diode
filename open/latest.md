# File open benchmark

- Recorded: 2026-11-05T10:44:35.292Z, commit `2aae2fa962fb`, diode nightly-2aae2fa
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 27 ms; binary floor (`diode --version` over PTY, median): 69 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **149 ms** | 107 ms | 176 ms | 295 ms | 13 ms | 268 MB | 11 |
| `medium` | 126.7 KB | 2000 | **149 ms** | 107 ms | 176 ms | 287 ms | 8 ms | 281 MB | 11 |
| `large` | 1.3 MB | 20000 | **163 ms** | 121 ms | 190 ms | 304 ms | 10 ms | 294 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **253 ms** | 211 ms | 280 ms | 380 ms | 16 ms | 346 MB | 5 |
| `log500m` | 497 MB | 5295839 | **158 ms** | 116 ms | 185 ms | — (plaintext) | 8 ms | 309 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 6 ms | 8 ms | 8 ms | 6 ms |
| node ready (bootstrapComplete) | 74 ms | 73 ms | 76 ms | 88 ms | 69 ms |
| bundle executed (main:start) | 74 ms | 73 ms | 76 ms | 88 ms | 69 ms |
| config loaded | 93 ms | 94 ms | 97 ms | 106 ms | 89 ms |
| keybindings loaded | 95 ms | 94 ms | 97 ms | 109 ms | 89 ms |
| session state loaded | 95 ms | 94 ms | 97 ms | 109 ms | 89 ms |
| extensions scanned | 89 ms | 90 ms | 92 ms | 103 ms | 84 ms |
| themes ready | 99 ms | 99 ms | 101 ms | 113 ms | 94 ms |
| DI container created | 102 ms | 104 ms | 105 ms | 116 ms | 98 ms |
| workbench mounted | 138 ms | 135 ms | 139 ms | 147 ms | 129 ms |
| first frame | 138 ms | 135 ms | 139 ms | 147 ms | 129 ms |
| workbench activated | 145 ms | 139 ms | 150 ms | 157 ms | 134 ms |
| grammars preloaded | 154 ms | 145 ms | 155 ms | 163 ms | 142 ms |
| file read from disk | 156 ms | 151 ms | 166 ms | 254 ms | 152 ms |
| file decoded | 156 ms | 151 ms | 166 ms | 254 ms | 152 ms |
| document built | 156 ms | 151 ms | 167 ms | 254 ms | 152 ms |
| tokenizer attached to editor | 176 ms | 174 ms | 191 ms | 282 ms | — |
| tabs opened | 160 ms | 157 ms | 175 ms | 266 ms | 171 ms |
| built-in extensions registered | 319 ms | 312 ms | 328 ms | 405 ms | 226 ms |
| frame with file text | 175 ms | 172 ms | 189 ms | 280 ms | 185 ms |
| frame with highlighting | 295 ms | 286 ms | 304 ms | 380 ms | — |
| extension host up | 566 ms | 594 ms | 672 ms | 1101 ms | 423 ms |
| startup complete | 311 ms | 304 ms | 320 ms | 396 ms | 216 ms |
| to text (black box) | 176 ms | 176 ms | 190 ms | 280 ms | 185 ms |
| to highlight (black box) | 295 ms | 287 ms | 304 ms | 380 ms | — |
| gap black − white (text) | 1 ms | 3 ms | 1 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 34 ms | 16 ms | 12 ms | 12 ms | — | 10 ms | 3 ms |
| `medium` failed | 33 ms | 14 ms | 12 ms | 13 ms | — | 6 ms | 8 ms |
| `large` failed | 34 ms | 24 ms | 15 ms | 20 ms | — | 14 ms | 18 ms |
| `xlarge` failed | 28 ms | 39 ms | 25 ms | 35 ms | — | 26 ms | 83 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
