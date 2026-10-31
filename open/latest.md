# File open benchmark

- Recorded: 2026-10-31T02:23:39.849Z, commit `dee3258735c1`, diode nightly-dee3258
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 21 ms; binary floor (`diode --version` over PTY, median): 51 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **106 ms** | 76 ms | 127 ms | 215 ms | 5 ms | 254 MB | 11 |
| `medium` | 126.7 KB | 2000 | **113 ms** | 83 ms | 134 ms | 225 ms | 5 ms | 282 MB | 11 |
| `large` | 1.3 MB | 20000 | **120 ms** | 90 ms | 141 ms | 250 ms | 8 ms | 299 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **184 ms** | 154 ms | 205 ms | 310 ms | 7 ms | 368 MB | 5 |
| `log500m` | 497 MB | 5295839 | **118 ms** | 88 ms | 139 ms | — (plaintext) | 3 ms | 270 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 5 ms | 6 ms | 8 ms | 5 ms |
| node ready (bootstrapComplete) | 57 ms | 57 ms | 58 ms | 67 ms | 52 ms |
| bundle executed (main:start) | 57 ms | 57 ms | 58 ms | 67 ms | 52 ms |
| config loaded | 73 ms | 71 ms | 75 ms | 81 ms | 67 ms |
| keybindings loaded | 73 ms | 71 ms | 75 ms | 81 ms | 68 ms |
| session state loaded | 73 ms | 72 ms | 75 ms | 81 ms | 68 ms |
| extensions scanned | 69 ms | 67 ms | 72 ms | 79 ms | 65 ms |
| themes ready | 76 ms | 75 ms | 78 ms | 84 ms | 71 ms |
| DI container created | 78 ms | 78 ms | 81 ms | 88 ms | 75 ms |
| workbench mounted | 101 ms | 103 ms | 103 ms | 112 ms | 99 ms |
| first frame | 101 ms | 103 ms | 103 ms | 112 ms | 99 ms |
| workbench activated | 105 ms | 107 ms | 106 ms | 117 ms | 103 ms |
| grammars preloaded | 109 ms | 115 ms | 115 ms | 121 ms | 109 ms |
| file read from disk | 111 ms | 118 ms | 124 ms | 188 ms | 116 ms |
| file decoded | 111 ms | 118 ms | 124 ms | 188 ms | 116 ms |
| document built | 111 ms | 118 ms | 124 ms | 188 ms | 117 ms |
| tokenizer attached to editor | 129 ms | 139 ms | 157 ms | 222 ms | — |
| tabs opened | 114 ms | 123 ms | 130 ms | 195 ms | 130 ms |
| built-in extensions registered | 236 ms | 246 ms | 267 ms | 327 ms | 174 ms |
| frame with file text | 127 ms | 133 ms | 141 ms | 205 ms | 139 ms |
| frame with highlighting | 214 ms | 225 ms | 250 ms | 310 ms | — |
| extension host up | 420 ms | 453 ms | 533 ms | 860 ms | 315 ms |
| startup complete | 232 ms | 241 ms | 263 ms | 323 ms | 169 ms |
| to text (black box) | 127 ms | 134 ms | 141 ms | 205 ms | 139 ms |
| to highlight (black box) | 215 ms | 225 ms | 250 ms | 310 ms | — |
| gap black − white (text) | 2 ms | 1 ms | 1 ms | 2 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 27 ms | 9 ms | 9 ms | 8 ms | 10 ms | 7 ms | 3 ms |
| `medium` | 27 ms | 10 ms | 9 ms | 7 ms | 17 ms | 6 ms | 3 ms |
| `large` | 34 ms | 16 ms | 13 ms | 14 ms | 38 ms | 11 ms | 12 ms |
| `xlarge` | 21 ms | 22 ms | 15 ms | 16 ms | 163 ms | 13 ms | 52 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
