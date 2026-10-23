# File open benchmark

- Recorded: 2026-10-23T00:04:47.167Z, commit `12d9a4f81c18`, diode nightly-12d9a4f
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 24 ms; binary floor (`diode --version` over PTY, median): 59 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **146 ms** | 112 ms | 171 ms | 285 ms | 10 ms | 244 MB | 11 |
| `medium` | 126.7 KB | 2000 | **171 ms** | 136 ms | 195 ms | 313 ms | 10 ms | 261 MB | 11 |
| `large` | 1.3 MB | 20000 | **302 ms** | 267 ms | 326 ms | 428 ms | 4 ms | 300 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **1475 ms** | 1440 ms | 1499 ms | 1599 ms | 37 ms | 691 MB | 5 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` |
| --- | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 8 ms | 8 ms | 12 ms |
| node ready (bootstrapComplete) | 67 ms | 69 ms | 68 ms | 87 ms |
| bundle executed (main:start) | 67 ms | 69 ms | 68 ms | 87 ms |
| config loaded | 86 ms | 86 ms | 91 ms | 105 ms |
| keybindings loaded | 87 ms | 87 ms | 91 ms | 105 ms |
| session state loaded | 88 ms | 87 ms | 92 ms | 105 ms |
| extensions scanned | 82 ms | 83 ms | 88 ms | 102 ms |
| themes ready | 91 ms | 91 ms | 95 ms | 110 ms |
| DI container created | 96 ms | 96 ms | 99 ms | 115 ms |
| workbench mounted | 129 ms | 128 ms | 129 ms | 146 ms |
| first frame | 129 ms | 128 ms | 129 ms | 146 ms |
| workbench activated | 137 ms | 134 ms | 135 ms | 152 ms |
| grammars preloaded | 147 ms | 142 ms | 144 ms | 158 ms |
| file read from disk | 148 ms | 144 ms | 155 ms | 253 ms |
| file decoded | 148 ms | 144 ms | 155 ms | 253 ms |
| document built | 148 ms | 144 ms | 155 ms | 254 ms |
| tokenizer attached to editor | 170 ms | 196 ms | 328 ms | 1501 ms |
| tabs opened | 153 ms | 154 ms | 174 ms | 293 ms |
| built-in extensions registered | 306 ms | 330 ms | 447 ms | 1617 ms |
| frame with file text | 169 ms | 194 ms | 326 ms | 1499 ms |
| frame with highlighting | 285 ms | 312 ms | 428 ms | 1599 ms |
| extension host up | 551 ms | 584 ms | 744 ms | 2320 ms |
| startup complete | 301 ms | 326 ms | 442 ms | 1613 ms |
| to text (black box) | 171 ms | 195 ms | 326 ms | 1499 ms |
| to highlight (black box) | 285 ms | 313 ms | 428 ms | 1599 ms |
| gap black − white (text) | 1 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 41 ms | 14 ms | 11 ms | 13 ms | 18 ms | 9 ms | 5 ms |
| `medium` | 39 ms | 11 ms | 13 ms | 9 ms | 19 ms | 7 ms | 4 ms |
| `large` | 46 ms | 22 ms | 25 ms | 20 ms | 44 ms | 12 ms | 17 ms |
| `xlarge` | 73 ms | 55 ms | 69 ms | 35 ms | 133 ms | 12 ms | 59 ms |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
