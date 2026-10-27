# File open benchmark

- Recorded: 2026-10-27T11:02:31.856Z, commit `3ad2d2bb1fc4`, diode nightly-3ad2d2b
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 27 ms; binary floor (`diode --version` over PTY, median): 65 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **138 ms** | 101 ms | 166 ms | 277 ms | 6 ms | 254 MB | 11 |
| `medium` | 126.7 KB | 2000 | **139 ms** | 101 ms | 166 ms | 279 ms | 6 ms | 279 MB | 11 |
| `large` | 1.3 MB | 20000 | **152 ms** | 114 ms | 179 ms | 303 ms | 3 ms | 294 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **235 ms** | 198 ms | 262 ms | 383 ms | 13 ms | 361 MB | 5 |
| `log500m` | 497 MB | 5295839 | **144 ms** | 107 ms | 172 ms | — (plaintext) | 2 ms | 269 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 7 ms | 9 ms | 6 ms |
| node ready (bootstrapComplete) | 72 ms | 71 ms | 71 ms | 83 ms | 65 ms |
| bundle executed (main:start) | 72 ms | 71 ms | 71 ms | 83 ms | 65 ms |
| config loaded | 89 ms | 87 ms | 91 ms | 103 ms | 80 ms |
| keybindings loaded | 89 ms | 88 ms | 91 ms | 103 ms | 81 ms |
| session state loaded | 89 ms | 88 ms | 92 ms | 103 ms | 81 ms |
| extensions scanned | 87 ms | 83 ms | 88 ms | 99 ms | 77 ms |
| themes ready | 96 ms | 93 ms | 96 ms | 107 ms | 85 ms |
| DI container created | 100 ms | 97 ms | 100 ms | 112 ms | 89 ms |
| workbench mounted | 129 ms | 126 ms | 129 ms | 139 ms | 122 ms |
| first frame | 129 ms | 126 ms | 129 ms | 139 ms | 122 ms |
| workbench activated | 135 ms | 131 ms | 134 ms | 143 ms | 127 ms |
| grammars preloaded | 145 ms | 141 ms | 142 ms | 149 ms | 133 ms |
| file read from disk | 147 ms | 145 ms | 154 ms | 238 ms | 143 ms |
| file decoded | 147 ms | 145 ms | 155 ms | 238 ms | 143 ms |
| document built | 147 ms | 145 ms | 155 ms | 238 ms | 143 ms |
| tokenizer attached to editor | 166 ms | 171 ms | 193 ms | 278 ms | — |
| tabs opened | 150 ms | 150 ms | 163 ms | 246 ms | 161 ms |
| built-in extensions registered | 301 ms | 301 ms | 323 ms | 402 ms | 203 ms |
| frame with file text | 164 ms | 164 ms | 176 ms | 261 ms | 172 ms |
| frame with highlighting | 277 ms | 278 ms | 303 ms | 383 ms | — |
| extension host up | 531 ms | 558 ms | 621 ms | 1043 ms | 392 ms |
| startup complete | 295 ms | 295 ms | 317 ms | 396 ms | 197 ms |
| to text (black box) | 166 ms | 166 ms | 179 ms | 262 ms | 172 ms |
| to highlight (black box) | 277 ms | 279 ms | 303 ms | 383 ms | — |
| gap black − white (text) | 2 ms | 1 ms | 2 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 30 ms | 13 ms | 10 ms | 10 ms | 14 ms | 7 ms | 3 ms |
| `medium` | 34 ms | 14 ms | 10 ms | 8 ms | 13 ms | 6 ms | 4 ms |
| `large` | 34 ms | 16 ms | 16 ms | 14 ms | 43 ms | 16 ms | 16 ms |
| `xlarge` | 33 ms | 16 ms | 9 ms | 11 ms | 103 ms | 8 ms | 79 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
