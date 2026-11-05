# File open benchmark

- Recorded: 2026-11-05T23:14:48.787Z, commit `dc1c38e1a12a`, diode nightly-dc1c38e
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 24 ms; binary floor (`diode --version` over PTY, median): 65 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **152 ms** | 112 ms | 177 ms | 292 ms | 8 ms | 266 MB | 11 |
| `medium` | 126.7 KB | 2000 | **157 ms** | 116 ms | 181 ms | 300 ms | 7 ms | 281 MB | 11 |
| `large` | 1.3 MB | 20000 | **168 ms** | 127 ms | 192 ms | 314 ms | 4 ms | 291 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **271 ms** | 230 ms | 295 ms | 396 ms | 5 ms | 344 MB | 5 |
| `log500m` | 497 MB | 5295839 | **168 ms** | 128 ms | 193 ms | — (plaintext) | 3 ms | 300 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 8 ms | 12 ms | 6 ms |
| node ready (bootstrapComplete) | 70 ms | 72 ms | 74 ms | 95 ms | 67 ms |
| bundle executed (main:start) | 70 ms | 72 ms | 74 ms | 95 ms | 67 ms |
| config loaded | 90 ms | 95 ms | 97 ms | 113 ms | 89 ms |
| keybindings loaded | 91 ms | 95 ms | 97 ms | 113 ms | 92 ms |
| session state loaded | 91 ms | 95 ms | 97 ms | 113 ms | 93 ms |
| extensions scanned | 85 ms | 89 ms | 91 ms | 108 ms | 85 ms |
| themes ready | 95 ms | 98 ms | 100 ms | 120 ms | 96 ms |
| DI container created | 99 ms | 102 ms | 104 ms | 125 ms | 100 ms |
| workbench mounted | 135 ms | 136 ms | 136 ms | 165 ms | 133 ms |
| first frame | 135 ms | 136 ms | 136 ms | 165 ms | 133 ms |
| workbench activated | 145 ms | 146 ms | 141 ms | 175 ms | 139 ms |
| grammars preloaded | 151 ms | 151 ms | 147 ms | 180 ms | 141 ms |
| file read from disk | 154 ms | 156 ms | 166 ms | 267 ms | 155 ms |
| file decoded | 154 ms | 156 ms | 166 ms | 267 ms | 155 ms |
| document built | 155 ms | 156 ms | 166 ms | 267 ms | 155 ms |
| tokenizer attached to editor | 176 ms | 182 ms | 192 ms | 297 ms | — |
| tabs opened | 159 ms | 163 ms | 176 ms | 278 ms | 175 ms |
| built-in extensions registered | 320 ms | 327 ms | 340 ms | 421 ms | 239 ms |
| frame with file text | 175 ms | 180 ms | 190 ms | 295 ms | 190 ms |
| frame with highlighting | 292 ms | 299 ms | 314 ms | 396 ms | — |
| extension host up | 584 ms | 629 ms | 709 ms | 1141 ms | 461 ms |
| startup complete | 312 ms | 318 ms | 332 ms | 413 ms | 228 ms |
| to text (black box) | 177 ms | 181 ms | 192 ms | 295 ms | 193 ms |
| to highlight (black box) | 292 ms | 300 ms | 314 ms | 396 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 1 ms | 0 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 43 ms | 14 ms | 15 ms | 14 ms | — | 9 ms | 5 ms |
| `medium` failed | 37 ms | 15 ms | 12 ms | 11 ms | — | 9 ms | 6 ms |
| `large` failed | 40 ms | 28 ms | 28 ms | 26 ms | — | 16 ms | 20 ms |
| `xlarge` failed | 30 ms | 50 ms | 26 ms | 49 ms | — | 24 ms | 105 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
