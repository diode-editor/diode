# File open benchmark

- Recorded: 2026-11-05T22:39:59.768Z, commit `4f241b291cec`, diode nightly-4f241b2
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 20 ms; binary floor (`diode --version` over PTY, median): 55 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **118 ms** | 82 ms | 137 ms | 224 ms | 8 ms | 269 MB | 11 |
| `medium` | 126.7 KB | 2000 | **122 ms** | 87 ms | 142 ms | 230 ms | 8 ms | 282 MB | 11 |
| `large` | 1.3 MB | 20000 | **137 ms** | 101 ms | 157 ms | 242 ms | 13 ms | 293 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **203 ms** | 167 ms | 223 ms | 298 ms | 2 ms | 352 MB | 5 |
| `log500m` | 497 MB | 5295839 | **130 ms** | 95 ms | 150 ms | — (plaintext) | 3 ms | 275 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 5 ms | 6 ms | 7 ms | 5 ms |
| node ready (bootstrapComplete) | 58 ms | 59 ms | 65 ms | 68 ms | 56 ms |
| bundle executed (main:start) | 58 ms | 59 ms | 65 ms | 68 ms | 56 ms |
| config loaded | 75 ms | 75 ms | 81 ms | 87 ms | 73 ms |
| keybindings loaded | 77 ms | 76 ms | 82 ms | 87 ms | 75 ms |
| session state loaded | 77 ms | 76 ms | 82 ms | 88 ms | 75 ms |
| extensions scanned | 72 ms | 71 ms | 77 ms | 85 ms | 70 ms |
| themes ready | 80 ms | 79 ms | 84 ms | 91 ms | 78 ms |
| DI container created | 82 ms | 83 ms | 86 ms | 93 ms | 81 ms |
| workbench mounted | 108 ms | 109 ms | 111 ms | 117 ms | 104 ms |
| first frame | 108 ms | 109 ms | 111 ms | 117 ms | 104 ms |
| workbench activated | 112 ms | 113 ms | 116 ms | 120 ms | 108 ms |
| grammars preloaded | 116 ms | 122 ms | 124 ms | 130 ms | 115 ms |
| file read from disk | 118 ms | 125 ms | 137 ms | 201 ms | 123 ms |
| file decoded | 118 ms | 125 ms | 137 ms | 201 ms | 123 ms |
| document built | 118 ms | 125 ms | 137 ms | 201 ms | 123 ms |
| tokenizer attached to editor | 134 ms | 143 ms | 158 ms | 222 ms | — |
| tabs opened | 122 ms | 129 ms | 144 ms | 209 ms | 138 ms |
| built-in extensions registered | 245 ms | 251 ms | 262 ms | 317 ms | 185 ms |
| frame with file text | 133 ms | 141 ms | 157 ms | 221 ms | 150 ms |
| frame with highlighting | 224 ms | 229 ms | 242 ms | 298 ms | — |
| extension host up | 437 ms | 481 ms | 532 ms | 912 ms | 348 ms |
| startup complete | 239 ms | 244 ms | 256 ms | 311 ms | 176 ms |
| to text (black box) | 137 ms | 142 ms | 157 ms | 223 ms | 150 ms |
| to highlight (black box) | 224 ms | 230 ms | 242 ms | 298 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 0 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 27 ms | 11 ms | 9 ms | 11 ms | — | 5 ms | 3 ms |
| `medium` failed | 30 ms | 13 ms | 8 ms | 9 ms | — | 4 ms | 4 ms |
| `large` failed | 33 ms | 21 ms | 20 ms | 16 ms | — | 14 ms | 15 ms |
| `xlarge` failed | 37 ms | 41 ms | 19 ms | 62 ms | — | 19 ms | 60 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
