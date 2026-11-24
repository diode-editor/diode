# File open benchmark

- Recorded: 2026-11-24T22:28:11.475Z, commit `91e61ba2c36a`, diode nightly-91e61ba
- Machine: AMD EPYC 9V45 96-Core Processor (4 cores, 16 GB), linux 7.0.0-1020-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 19 ms; binary floor (`diode --version` over PTY, median): 51 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **115 ms** | 83 ms | 134 ms | 214 ms | 6 ms | 295 MB | 11 |
| `medium` | 126.7 KB | 2000 | **122 ms** | 90 ms | 141 ms | 226 ms | 11 ms | 302 MB | 11 |
| `large` | 1.3 MB | 20000 | **138 ms** | 106 ms | 157 ms | 240 ms | 4 ms | 319 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **204 ms** | 172 ms | 223 ms | 281 ms | 14 ms | 378 MB | 5 |
| `log500m` | 497 MB | 5295839 | **136 ms** | 104 ms | 155 ms | — (plaintext) | 41 ms ⚠ noisy | 355 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 6 ms | 6 ms | 12 ms | 5 ms |
| node ready (bootstrapComplete) | 56 ms | 59 ms | 64 ms | 77 ms | 57 ms |
| bundle executed (main:start) | 56 ms | 59 ms | 64 ms | 77 ms | 57 ms |
| config loaded | 73 ms | 74 ms | 83 ms | 102 ms | 78 ms |
| keybindings loaded | 73 ms | 76 ms | 84 ms | 102 ms | 78 ms |
| session state loaded | 74 ms | 76 ms | 84 ms | 103 ms | 79 ms |
| extensions scanned | 68 ms | 71 ms | 79 ms | 96 ms | 72 ms |
| themes ready | 78 ms | 79 ms | 88 ms | 105 ms | 81 ms |
| DI container created | 80 ms | 81 ms | 90 ms | 108 ms | 83 ms |
| workbench mounted | 108 ms | 109 ms | 122 ms | 138 ms | 112 ms |
| first frame | 108 ms | 109 ms | 122 ms | 138 ms | 112 ms |
| workbench activated | 114 ms | 115 ms | 126 ms | 143 ms | 117 ms |
| grammars preloaded | 118 ms | 119 ms | 130 ms | 147 ms | 119 ms |
| file read from disk | 120 ms | 122 ms | 138 ms | 202 ms | 126 ms |
| file decoded | 120 ms | 122 ms | 138 ms | 202 ms | 126 ms |
| document built | 120 ms | 122 ms | 138 ms | 202 ms | 126 ms |
| tokenizer attached to editor | 135 ms | 140 ms | 158 ms | 222 ms | — |
| tabs opened | 123 ms | 127 ms | 144 ms | 211 ms | 142 ms |
| built-in extensions registered | 238 ms | 249 ms | 265 ms | 304 ms | 190 ms |
| frame with file text | 134 ms | 139 ms | 156 ms | 220 ms | 153 ms |
| frame with highlighting | 214 ms | 225 ms | 240 ms | 281 ms | — |
| extension host up | 402 ms | 453 ms | 503 ms | 846 ms | 325 ms |
| startup complete | 231 ms | 241 ms | 257 ms | 296 ms | 179 ms |
| to text (black box) | 134 ms | 141 ms | 157 ms | 223 ms | 155 ms |
| to highlight (black box) | 214 ms | 226 ms | 240 ms | 281 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 2 ms | 0 ms | 2 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 11 ms | 7 ms | 6 ms | 6 ms | — | 4 ms | 2 ms |
| `medium` failed | 23 ms | 17 ms | 9 ms | 8 ms | — | 5 ms | 4 ms |
| `large` failed | 28 ms | 19 ms | 18 ms | 19 ms | — | 16 ms | 12 ms |
| `xlarge` failed | 40 ms | 38 ms | 20 ms | 20 ms | — | 11 ms | 41 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
