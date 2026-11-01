# File open benchmark

- Recorded: 2026-11-01T12:20:31.446Z, commit `de3541c451e7`, diode nightly-de3541c
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 31 ms; binary floor (`diode --version` over PTY, median): 73 ms; for reference `node --version`: 5 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **144 ms** | 102 ms | 175 ms | 293 ms | 10 ms | 256 MB | 11 |
| `medium` | 126.7 KB | 2000 | **148 ms** | 105 ms | 178 ms | 295 ms | 5 ms | 281 MB | 11 |
| `large` | 1.3 MB | 20000 | **158 ms** | 115 ms | 188 ms | 330 ms | 11 ms | 291 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **250 ms** | 208 ms | 281 ms | 412 ms | 24 ms | 365 MB | 5 |
| `log500m` | 497 MB | 5295839 | **153 ms** | 111 ms | 184 ms | — (plaintext) | 3 ms | 304 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 6 ms | 7 ms | 10 ms | 6 ms |
| node ready (bootstrapComplete) | 71 ms | 69 ms | 72 ms | 92 ms | 66 ms |
| bundle executed (main:start) | 71 ms | 69 ms | 72 ms | 92 ms | 66 ms |
| config loaded | 90 ms | 88 ms | 93 ms | 112 ms | 90 ms |
| keybindings loaded | 90 ms | 89 ms | 93 ms | 117 ms | 90 ms |
| session state loaded | 90 ms | 89 ms | 93 ms | 117 ms | 90 ms |
| extensions scanned | 84 ms | 84 ms | 89 ms | 108 ms | 84 ms |
| themes ready | 96 ms | 94 ms | 98 ms | 120 ms | 93 ms |
| DI container created | 100 ms | 99 ms | 102 ms | 124 ms | 97 ms |
| workbench mounted | 135 ms | 134 ms | 134 ms | 155 ms | 128 ms |
| first frame | 135 ms | 134 ms | 134 ms | 155 ms | 128 ms |
| workbench activated | 144 ms | 144 ms | 140 ms | 160 ms | 133 ms |
| grammars preloaded | 150 ms | 149 ms | 146 ms | 166 ms | 136 ms |
| file read from disk | 153 ms | 153 ms | 158 ms | 256 ms | 150 ms |
| file decoded | 153 ms | 153 ms | 158 ms | 256 ms | 150 ms |
| document built | 153 ms | 154 ms | 159 ms | 256 ms | 150 ms |
| tokenizer attached to editor | 176 ms | 183 ms | 203 ms | 298 ms | — |
| tabs opened | 158 ms | 161 ms | 170 ms | 265 ms | 170 ms |
| built-in extensions registered | 319 ms | 321 ms | 354 ms | 436 ms | 232 ms |
| frame with file text | 174 ms | 176 ms | 186 ms | 281 ms | 184 ms |
| frame with highlighting | 293 ms | 294 ms | 329 ms | 412 ms | — |
| extension host up | 567 ms | 607 ms | 675 ms | 1113 ms | 416 ms |
| startup complete | 313 ms | 315 ms | 348 ms | 430 ms | 224 ms |
| to text (black box) | 175 ms | 178 ms | 188 ms | 281 ms | 184 ms |
| to highlight (black box) | 293 ms | 295 ms | 330 ms | 412 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 2 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 33 ms | 14 ms | 12 ms | 13 ms | 23 ms | 8 ms | 3 ms |
| `medium` | 32 ms | 14 ms | 12 ms | 11 ms | 21 ms | 7 ms | 6 ms |
| `large` | 39 ms | 29 ms | 31 ms | 21 ms | 39 ms | 16 ms | 17 ms |
| `xlarge` | 29 ms | 43 ms | 22 ms | 27 ms | 155 ms | 14 ms | 76 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
