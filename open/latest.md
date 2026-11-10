# File open benchmark

- Recorded: 2026-11-10T04:06:09.435Z, commit `2d2815c0b1ed`, diode nightly-2d2815c
- Machine: AMD EPYC 9V45 96-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 19 ms; binary floor (`diode --version` over PTY, median): 49 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **115 ms** | 86 ms | 134 ms | 210 ms | 6 ms | 271 MB | 11 |
| `medium` | 126.7 KB | 2000 | **115 ms** | 85 ms | 134 ms | 207 ms | 10 ms | 289 MB | 11 |
| `large` | 1.3 MB | 20000 | **115 ms** | 86 ms | 134 ms | 212 ms | 8 ms | 304 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **189 ms** | 160 ms | 209 ms | 271 ms | 9 ms | 360 MB | 5 |
| `log500m` | 497 MB | 5295839 | **123 ms** | 94 ms | 142 ms | — (plaintext) | 2 ms | 317 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 5 ms | 6 ms | 9 ms | 5 ms |
| node ready (bootstrapComplete) | 54 ms | 54 ms | 53 ms | 68 ms | 50 ms |
| bundle executed (main:start) | 54 ms | 54 ms | 53 ms | 68 ms | 50 ms |
| config loaded | 67 ms | 69 ms | 66 ms | 93 ms | 69 ms |
| keybindings loaded | 68 ms | 69 ms | 68 ms | 93 ms | 69 ms |
| session state loaded | 68 ms | 69 ms | 68 ms | 93 ms | 69 ms |
| extensions scanned | 63 ms | 66 ms | 62 ms | 86 ms | 67 ms |
| themes ready | 73 ms | 73 ms | 70 ms | 99 ms | 72 ms |
| DI container created | 75 ms | 76 ms | 72 ms | 101 ms | 74 ms |
| workbench mounted | 102 ms | 99 ms | 95 ms | 124 ms | 99 ms |
| first frame | 102 ms | 99 ms | 95 ms | 124 ms | 99 ms |
| workbench activated | 107 ms | 104 ms | 101 ms | 129 ms | 105 ms |
| grammars preloaded | 114 ms | 113 ms | 110 ms | 132 ms | 109 ms |
| file read from disk | 116 ms | 115 ms | 117 ms | 184 ms | 116 ms |
| file decoded | 116 ms | 115 ms | 117 ms | 184 ms | 116 ms |
| document built | 116 ms | 115 ms | 117 ms | 184 ms | 116 ms |
| tokenizer attached to editor | 132 ms | 133 ms | 136 ms | 207 ms | — |
| tabs opened | 119 ms | 120 ms | 124 ms | 191 ms | 129 ms |
| built-in extensions registered | 231 ms | 228 ms | 230 ms | 291 ms | 175 ms |
| frame with file text | 131 ms | 131 ms | 134 ms | 205 ms | 142 ms |
| frame with highlighting | 209 ms | 207 ms | 211 ms | 271 ms | — |
| extension host up | 394 ms | 412 ms | 453 ms | 785 ms | 323 ms |
| startup complete | 224 ms | 220 ms | 223 ms | 285 ms | 167 ms |
| to text (black box) | 134 ms | 134 ms | 134 ms | 209 ms | 142 ms |
| to highlight (black box) | 210 ms | 207 ms | 212 ms | 271 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 1 ms | 3 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 11 ms | 10 ms | 8 ms | 7 ms | — | 4 ms | 2 ms |
| `medium` failed | 21 ms | 11 ms | 7 ms | 6 ms | — | 3 ms | 4 ms |
| `large` failed | 21 ms | 18 ms | 16 ms | 13 ms | — | 16 ms | 13 ms |
| `xlarge` failed | 21 ms | 19 ms | 12 ms | 19 ms | — | 12 ms | 40 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
