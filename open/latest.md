# File open benchmark

- Recorded: 2026-11-02T10:42:29.895Z, commit `343db8374435`, diode nightly-343db83
- Machine: Intel(R) Xeon(R) Platinum 8370C CPU @ 2.80GHz (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 61 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **135 ms** | 99 ms | 160 ms | 269 ms | 4 ms | 256 MB | 11 |
| `medium` | 126.7 KB | 2000 | **138 ms** | 103 ms | 164 ms | 280 ms | 10 ms | 282 MB | 11 |
| `large` | 1.3 MB | 20000 | **151 ms** | 116 ms | 177 ms | 305 ms | 7 ms | 297 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **231 ms** | 196 ms | 257 ms | 383 ms | 9 ms | 366 MB | 5 |
| `log500m` | 497 MB | 5295839 | **144 ms** | 109 ms | 170 ms | — (plaintext) | 4 ms | 306 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 6 ms | 7 ms | 4 ms |
| node ready (bootstrapComplete) | 62 ms | 62 ms | 63 ms | 76 ms | 58 ms |
| bundle executed (main:start) | 62 ms | 62 ms | 64 ms | 76 ms | 58 ms |
| config loaded | 80 ms | 81 ms | 83 ms | 94 ms | 80 ms |
| keybindings loaded | 80 ms | 81 ms | 83 ms | 94 ms | 80 ms |
| session state loaded | 81 ms | 81 ms | 84 ms | 94 ms | 80 ms |
| extensions scanned | 77 ms | 76 ms | 79 ms | 89 ms | 76 ms |
| themes ready | 85 ms | 85 ms | 88 ms | 100 ms | 83 ms |
| DI container created | 89 ms | 89 ms | 92 ms | 103 ms | 86 ms |
| workbench mounted | 120 ms | 120 ms | 123 ms | 132 ms | 116 ms |
| first frame | 120 ms | 120 ms | 123 ms | 132 ms | 116 ms |
| workbench activated | 125 ms | 126 ms | 128 ms | 136 ms | 120 ms |
| grammars preloaded | 136 ms | 137 ms | 140 ms | 143 ms | 123 ms |
| file read from disk | 138 ms | 141 ms | 154 ms | 233 ms | 136 ms |
| file decoded | 138 ms | 141 ms | 154 ms | 233 ms | 136 ms |
| document built | 139 ms | 141 ms | 154 ms | 233 ms | 136 ms |
| tokenizer attached to editor | 160 ms | 168 ms | 192 ms | 272 ms | — |
| tabs opened | 143 ms | 147 ms | 162 ms | 243 ms | 155 ms |
| built-in extensions registered | 290 ms | 301 ms | 323 ms | 401 ms | 206 ms |
| frame with file text | 158 ms | 162 ms | 176 ms | 256 ms | 170 ms |
| frame with highlighting | 268 ms | 280 ms | 305 ms | 383 ms | — |
| extension host up | 520 ms | 550 ms | 623 ms | 1044 ms | 390 ms |
| startup complete | 285 ms | 294 ms | 317 ms | 395 ms | 200 ms |
| to text (black box) | 160 ms | 164 ms | 177 ms | 257 ms | 170 ms |
| to highlight (black box) | 269 ms | 280 ms | 305 ms | 383 ms | — |
| gap black − white (text) | 2 ms | 1 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 30 ms | 12 ms | 9 ms | 9 ms | 20 ms | 7 ms | 4 ms |
| `medium` | 35 ms | 15 ms | 10 ms | 12 ms | 22 ms | 6 ms | 5 ms |
| `large` | 36 ms | 28 ms | 18 ms | 23 ms | 45 ms | 14 ms | 18 ms |
| `xlarge` | 38 ms | 37 ms | 24 ms | 25 ms | 121 ms | 14 ms | 73 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
