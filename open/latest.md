# File open benchmark

- Recorded: 2026-10-27T22:21:03.990Z, commit `7679a7119f73`, diode nightly-7679a71
- Machine: AMD EPYC 9V45 96-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 20 ms; binary floor (`diode --version` over PTY, median): 48 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **107 ms** | 79 ms | 128 ms | 209 ms | 8 ms | 255 MB | 11 |
| `medium` | 126.7 KB | 2000 | **105 ms** | 76 ms | 125 ms | 210 ms | 6 ms | 281 MB | 11 |
| `large` | 1.3 MB | 20000 | **121 ms** | 93 ms | 141 ms | 226 ms | 9 ms | 300 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **170 ms** | 142 ms | 190 ms | 283 ms | 5 ms | 380 MB | 5 |
| `log500m` | 497 MB | 5295839 | **115 ms** | 87 ms | 135 ms | — (plaintext) | 6 ms | 269 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 7 ms | 7 ms | 7 ms | 6 ms |
| node ready (bootstrapComplete) | 52 ms | 54 ms | 57 ms | 66 ms | 52 ms |
| bundle executed (main:start) | 52 ms | 54 ms | 57 ms | 66 ms | 52 ms |
| config loaded | 66 ms | 67 ms | 71 ms | 85 ms | 65 ms |
| keybindings loaded | 67 ms | 68 ms | 71 ms | 86 ms | 65 ms |
| session state loaded | 67 ms | 68 ms | 72 ms | 86 ms | 65 ms |
| extensions scanned | 64 ms | 65 ms | 69 ms | 81 ms | 63 ms |
| themes ready | 70 ms | 71 ms | 75 ms | 88 ms | 68 ms |
| DI container created | 73 ms | 74 ms | 78 ms | 90 ms | 71 ms |
| workbench mounted | 96 ms | 96 ms | 102 ms | 110 ms | 94 ms |
| first frame | 96 ms | 96 ms | 102 ms | 110 ms | 93 ms |
| workbench activated | 100 ms | 99 ms | 106 ms | 113 ms | 97 ms |
| grammars preloaded | 108 ms | 107 ms | 114 ms | 117 ms | 103 ms |
| file read from disk | 110 ms | 109 ms | 123 ms | 168 ms | 111 ms |
| file decoded | 110 ms | 109 ms | 123 ms | 168 ms | 111 ms |
| document built | 110 ms | 109 ms | 123 ms | 169 ms | 111 ms |
| tokenizer attached to editor | 127 ms | 131 ms | 156 ms | 205 ms | — |
| tabs opened | 113 ms | 114 ms | 130 ms | 175 ms | 123 ms |
| built-in extensions registered | 230 ms | 229 ms | 245 ms | 299 ms | 165 ms |
| frame with file text | 125 ms | 124 ms | 140 ms | 188 ms | 135 ms |
| frame with highlighting | 209 ms | 210 ms | 226 ms | 283 ms | — |
| extension host up | 413 ms | 413 ms | 459 ms | 784 ms | 294 ms |
| startup complete | 225 ms | 225 ms | 241 ms | 296 ms | 160 ms |
| to text (black box) | 128 ms | 125 ms | 141 ms | 190 ms | 135 ms |
| to highlight (black box) | 209 ms | 210 ms | 226 ms | 283 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 19 ms | 9 ms | 9 ms | 7 ms | 12 ms | 5 ms | 3 ms |
| `medium` | 23 ms | 11 ms | 12 ms | 8 ms | 15 ms | 5 ms | 3 ms |
| `large` | 32 ms | 22 ms | 17 ms | 16 ms | 45 ms | 10 ms | 12 ms |
| `xlarge` | 25 ms | 31 ms | 17 ms | 11 ms | 191 ms | 14 ms | 43 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
