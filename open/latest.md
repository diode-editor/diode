# File open benchmark

- Recorded: 2026-11-05T08:01:29.215Z, commit `5dc77f2292ac`, diode nightly-5dc77f2
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 22 ms; binary floor (`diode --version` over PTY, median): 58 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **125 ms** | 88 ms | 147 ms | 234 ms | 6 ms | 260 MB | 11 |
| `medium` | 126.7 KB | 2000 | **129 ms** | 92 ms | 150 ms | 242 ms | 3 ms | 281 MB | 11 |
| `large` | 1.3 MB | 20000 | **134 ms** | 97 ms | 155 ms | 242 ms | 4 ms | 293 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **214 ms** | 177 ms | 235 ms | 316 ms | 14 ms | 351 MB | 5 |
| `log500m` | 497 MB | 5295839 | **133 ms** | 96 ms | 154 ms | — (plaintext) | 1 ms | 273 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 6 ms | 6 ms | 8 ms | 5 ms |
| node ready (bootstrapComplete) | 62 ms | 63 ms | 62 ms | 78 ms | 56 ms |
| bundle executed (main:start) | 62 ms | 63 ms | 62 ms | 78 ms | 56 ms |
| config loaded | 78 ms | 77 ms | 81 ms | 98 ms | 72 ms |
| keybindings loaded | 79 ms | 77 ms | 81 ms | 98 ms | 72 ms |
| session state loaded | 79 ms | 77 ms | 81 ms | 98 ms | 72 ms |
| extensions scanned | 75 ms | 73 ms | 78 ms | 93 ms | 69 ms |
| themes ready | 85 ms | 83 ms | 85 ms | 101 ms | 77 ms |
| DI container created | 88 ms | 87 ms | 88 ms | 104 ms | 80 ms |
| workbench mounted | 116 ms | 113 ms | 115 ms | 129 ms | 108 ms |
| first frame | 115 ms | 113 ms | 115 ms | 129 ms | 108 ms |
| workbench activated | 119 ms | 118 ms | 119 ms | 133 ms | 112 ms |
| grammars preloaded | 126 ms | 127 ms | 123 ms | 143 ms | 118 ms |
| file read from disk | 128 ms | 130 ms | 135 ms | 211 ms | 127 ms |
| file decoded | 128 ms | 130 ms | 135 ms | 211 ms | 127 ms |
| document built | 129 ms | 130 ms | 135 ms | 211 ms | 127 ms |
| tokenizer attached to editor | 145 ms | 149 ms | 156 ms | 234 ms | — |
| tabs opened | 132 ms | 135 ms | 142 ms | 219 ms | 142 ms |
| built-in extensions registered | 255 ms | 264 ms | 265 ms | 337 ms | 189 ms |
| frame with file text | 145 ms | 147 ms | 154 ms | 232 ms | 154 ms |
| frame with highlighting | 234 ms | 242 ms | 241 ms | 315 ms | — |
| extension host up | 468 ms | 508 ms | 564 ms | 946 ms | 359 ms |
| startup complete | 249 ms | 256 ms | 257 ms | 328 ms | 181 ms |
| to text (black box) | 147 ms | 150 ms | 155 ms | 235 ms | 154 ms |
| to highlight (black box) | 234 ms | 242 ms | 242 ms | 316 ms | — |
| gap black − white (text) | 1 ms | 3 ms | 1 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 33 ms | 15 ms | 9 ms | 10 ms | — | 6 ms | 3 ms |
| `medium` failed | 29 ms | 11 ms | 9 ms | 11 ms | — | 5 ms | 5 ms |
| `large` failed | 37 ms | 25 ms | 24 ms | 20 ms | — | 14 ms | 13 ms |
| `xlarge` failed | 24 ms | 39 ms | 20 ms | 33 ms | — | 19 ms | 70 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
