# File open benchmark

- Recorded: 2026-10-26T00:54:46.297Z, commit `7c810b40502b`, diode nightly-7c810b4
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 60 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **131 ms** | 96 ms | 156 ms | 272 ms | 12 ms | 253 MB | 11 |
| `medium` | 126.7 KB | 2000 | **138 ms** | 103 ms | 163 ms | 278 ms | 5 ms | 253 MB | 11 |
| `large` | 1.3 MB | 20000 | **148 ms** | 112 ms | 172 ms | 286 ms | 11 ms | 294 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **232 ms** | 197 ms | 257 ms | 354 ms | 16 ms | 356 MB | 5 |
| `log500m` | 497 MB | 5295839 | **147 ms** | 112 ms | 172 ms | — (plaintext) | 5 ms | 300 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 7 ms | 7 ms | 6 ms |
| node ready (bootstrapComplete) | 66 ms | 65 ms | 67 ms | 75 ms | 61 ms |
| bundle executed (main:start) | 66 ms | 65 ms | 67 ms | 75 ms | 61 ms |
| config loaded | 84 ms | 84 ms | 89 ms | 92 ms | 83 ms |
| keybindings loaded | 85 ms | 85 ms | 89 ms | 94 ms | 83 ms |
| session state loaded | 85 ms | 85 ms | 89 ms | 94 ms | 84 ms |
| extensions scanned | 80 ms | 80 ms | 85 ms | 90 ms | 79 ms |
| themes ready | 89 ms | 88 ms | 92 ms | 97 ms | 86 ms |
| DI container created | 93 ms | 92 ms | 96 ms | 101 ms | 90 ms |
| workbench mounted | 123 ms | 124 ms | 125 ms | 133 ms | 120 ms |
| first frame | 123 ms | 124 ms | 125 ms | 133 ms | 120 ms |
| workbench activated | 128 ms | 130 ms | 131 ms | 139 ms | 124 ms |
| grammars preloaded | 135 ms | 139 ms | 137 ms | 145 ms | 126 ms |
| file read from disk | 138 ms | 142 ms | 150 ms | 234 ms | 138 ms |
| file decoded | 138 ms | 142 ms | 150 ms | 234 ms | 138 ms |
| document built | 138 ms | 142 ms | 150 ms | 234 ms | 139 ms |
| tokenizer attached to editor | 157 ms | 164 ms | 174 ms | 259 ms | — |
| tabs opened | 141 ms | 148 ms | 160 ms | 244 ms | 158 ms |
| built-in extensions registered | 291 ms | 297 ms | 306 ms | 372 ms | 209 ms |
| frame with file text | 156 ms | 163 ms | 172 ms | 257 ms | 171 ms |
| frame with highlighting | 270 ms | 277 ms | 285 ms | 354 ms | — |
| extension host up | 535 ms | 562 ms | 615 ms | 941 ms | 382 ms |
| startup complete | 286 ms | 293 ms | 300 ms | 368 ms | 204 ms |
| to text (black box) | 156 ms | 163 ms | 172 ms | 257 ms | 172 ms |
| to highlight (black box) | 272 ms | 278 ms | 286 ms | 354 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 0 ms | 0 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 42 ms | 14 ms | 10 ms | 9 ms | 14 ms | 6 ms | 3 ms |
| `medium` | 35 ms | 14 ms | 11 ms | 11 ms | 16 ms | 6 ms | 5 ms |
| `large` | 31 ms | 16 ms | 15 ms | 15 ms | 45 ms | 16 ms | 17 ms |
| `xlarge` | 28 ms | 19 ms | 10 ms | 11 ms | 92 ms | 8 ms | 67 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
