# File open benchmark

- Recorded: 2026-10-30T23:16:02.359Z, commit `00d94a846e95`, diode nightly-00d94a8
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 21 ms; binary floor (`diode --version` over PTY, median): 53 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **111 ms** | 79 ms | 132 ms | 220 ms | 6 ms | 262 MB | 11 |
| `medium` | 126.7 KB | 2000 | **123 ms** | 91 ms | 144 ms | 237 ms | 6 ms | 279 MB | 11 |
| `large` | 1.3 MB | 20000 | **133 ms** | 101 ms | 154 ms | 253 ms | 8 ms | 299 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **198 ms** | 167 ms | 219 ms | 325 ms | 8 ms | 375 MB | 5 |
| `log500m` | 497 MB | 5295839 | **124 ms** | 92 ms | 145 ms | — (plaintext) | 4 ms | 269 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 7 ms | 8 ms | 5 ms |
| node ready (bootstrapComplete) | 58 ms | 61 ms | 61 ms | 72 ms | 54 ms |
| bundle executed (main:start) | 58 ms | 61 ms | 61 ms | 72 ms | 54 ms |
| config loaded | 75 ms | 77 ms | 78 ms | 86 ms | 67 ms |
| keybindings loaded | 76 ms | 78 ms | 78 ms | 86 ms | 68 ms |
| session state loaded | 76 ms | 78 ms | 78 ms | 86 ms | 68 ms |
| extensions scanned | 71 ms | 75 ms | 74 ms | 84 ms | 65 ms |
| themes ready | 80 ms | 81 ms | 81 ms | 91 ms | 72 ms |
| DI container created | 83 ms | 85 ms | 85 ms | 94 ms | 76 ms |
| workbench mounted | 106 ms | 110 ms | 110 ms | 118 ms | 100 ms |
| first frame | 105 ms | 110 ms | 110 ms | 118 ms | 100 ms |
| workbench activated | 109 ms | 114 ms | 115 ms | 122 ms | 105 ms |
| grammars preloaded | 115 ms | 122 ms | 124 ms | 126 ms | 111 ms |
| file read from disk | 117 ms | 125 ms | 134 ms | 200 ms | 121 ms |
| file decoded | 117 ms | 125 ms | 134 ms | 200 ms | 121 ms |
| document built | 117 ms | 125 ms | 134 ms | 200 ms | 121 ms |
| tokenizer attached to editor | 132 ms | 148 ms | 167 ms | 236 ms | — |
| tabs opened | 120 ms | 130 ms | 140 ms | 207 ms | 134 ms |
| built-in extensions registered | 241 ms | 257 ms | 275 ms | 344 ms | 177 ms |
| frame with file text | 131 ms | 142 ms | 151 ms | 219 ms | 145 ms |
| frame with highlighting | 220 ms | 236 ms | 252 ms | 325 ms | — |
| extension host up | 429 ms | 475 ms | 529 ms | 882 ms | 317 ms |
| startup complete | 236 ms | 253 ms | 270 ms | 339 ms | 172 ms |
| to text (black box) | 132 ms | 144 ms | 154 ms | 219 ms | 145 ms |
| to highlight (black box) | 220 ms | 237 ms | 253 ms | 325 ms | — |
| gap black − white (text) | 1 ms | 3 ms | 3 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 28 ms | 10 ms | 9 ms | 8 ms | 13 ms | 5 ms | 3 ms |
| `medium` | 26 ms | 11 ms | 10 ms | 8 ms | 14 ms | 5 ms | 3 ms |
| `large` | 29 ms | 19 ms | 22 ms | 17 ms | 42 ms | 11 ms | 11 ms |
| `xlarge` | 24 ms | 24 ms | 14 ms | 17 ms | 165 ms | 16 ms | 56 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
