# File open benchmark

- Recorded: 2026-11-24T21:34:18.001Z, commit `b5a29c566d2a`, diode nightly-b5a29c5
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1020-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 22 ms; binary floor (`diode --version` over PTY, median): 63 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **141 ms** | 100 ms | 163 ms | 250 ms | 6 ms | 294 MB | 11 |
| `medium` | 126.7 KB | 2000 | **142 ms** | 101 ms | 164 ms | 254 ms | 7 ms | 301 MB | 11 |
| `large` | 1.3 MB | 20000 | **159 ms** | 118 ms | 181 ms | 269 ms | 5 ms | 315 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **226 ms** | 186 ms | 248 ms | 324 ms | 5 ms | 364 MB | 5 |
| `log500m` | 497 MB | 5295839 | **151 ms** | 110 ms | 173 ms | — (plaintext) | 6 ms | 320 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 5 ms | 6 ms | 7 ms | 5 ms |
| node ready (bootstrapComplete) | 67 ms | 67 ms | 69 ms | 80 ms | 64 ms |
| bundle executed (main:start) | 67 ms | 67 ms | 69 ms | 80 ms | 64 ms |
| config loaded | 87 ms | 84 ms | 86 ms | 99 ms | 79 ms |
| keybindings loaded | 87 ms | 86 ms | 86 ms | 101 ms | 80 ms |
| session state loaded | 88 ms | 86 ms | 86 ms | 101 ms | 80 ms |
| extensions scanned | 81 ms | 79 ms | 81 ms | 94 ms | 75 ms |
| themes ready | 93 ms | 91 ms | 92 ms | 104 ms | 85 ms |
| DI container created | 96 ms | 95 ms | 95 ms | 107 ms | 88 ms |
| workbench mounted | 129 ms | 130 ms | 134 ms | 144 ms | 124 ms |
| first frame | 129 ms | 130 ms | 134 ms | 144 ms | 124 ms |
| workbench activated | 137 ms | 137 ms | 144 ms | 155 ms | 137 ms |
| grammars preloaded | 141 ms | 141 ms | 148 ms | 160 ms | 139 ms |
| file read from disk | 143 ms | 145 ms | 161 ms | 228 ms | 147 ms |
| file decoded | 144 ms | 145 ms | 161 ms | 228 ms | 148 ms |
| document built | 144 ms | 145 ms | 161 ms | 228 ms | 148 ms |
| tokenizer attached to editor | 161 ms | 165 ms | 182 ms | 250 ms | — |
| tabs opened | 148 ms | 150 ms | 169 ms | 237 ms | 162 ms |
| built-in extensions registered | 277 ms | 282 ms | 298 ms | 351 ms | 216 ms |
| frame with file text | 161 ms | 163 ms | 180 ms | 248 ms | 173 ms |
| frame with highlighting | 250 ms | 254 ms | 269 ms | 324 ms | — |
| extension host up | 481 ms | 528 ms | 600 ms | 966 ms | 377 ms |
| startup complete | 267 ms | 273 ms | 288 ms | 342 ms | 205 ms |
| to text (black box) | 163 ms | 164 ms | 181 ms | 248 ms | 173 ms |
| to highlight (black box) | 250 ms | 254 ms | 269 ms | 324 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 1 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 31 ms | 13 ms | 10 ms | 8 ms | — | 6 ms | 3 ms |
| `medium` failed | 30 ms | 15 ms | 8 ms | 12 ms | — | 6 ms | 5 ms |
| `large` failed | 41 ms | 18 ms | 17 ms | 14 ms | — | 13 ms | 17 ms |
| `xlarge` failed | 29 ms | 29 ms | 15 ms | 15 ms | — | 11 ms | 63 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
