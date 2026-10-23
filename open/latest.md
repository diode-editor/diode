# File open benchmark

- Recorded: 2026-10-23T18:03:51.595Z, commit `ecef8c207328`, diode nightly-ecef8c2
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 62 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **130 ms** | 94 ms | 156 ms | 271 ms | 21 ms | 244 MB | 11 |
| `medium` | 126.7 KB | 2000 | **134 ms** | 97 ms | 159 ms | 277 ms | 6 ms | 247 MB | 11 |
| `large` | 1.3 MB | 20000 | **144 ms** | 108 ms | 170 ms | 281 ms | 5 ms | 287 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **227 ms** | 190 ms | 252 ms | 352 ms | 7 ms | 475 MB | 5 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` |
| --- | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 7 ms | 10 ms |
| node ready (bootstrapComplete) | 68 ms | 68 ms | 69 ms | 78 ms |
| bundle executed (main:start) | 68 ms | 68 ms | 69 ms | 78 ms |
| config loaded | 86 ms | 86 ms | 87 ms | 101 ms |
| keybindings loaded | 86 ms | 87 ms | 87 ms | 101 ms |
| session state loaded | 86 ms | 87 ms | 87 ms | 101 ms |
| extensions scanned | 82 ms | 84 ms | 84 ms | 98 ms |
| themes ready | 90 ms | 90 ms | 92 ms | 104 ms |
| DI container created | 94 ms | 94 ms | 96 ms | 107 ms |
| workbench mounted | 123 ms | 123 ms | 123 ms | 132 ms |
| first frame | 123 ms | 123 ms | 123 ms | 132 ms |
| workbench activated | 128 ms | 128 ms | 128 ms | 137 ms |
| grammars preloaded | 138 ms | 137 ms | 134 ms | 146 ms |
| file read from disk | 140 ms | 139 ms | 146 ms | 229 ms |
| file decoded | 140 ms | 139 ms | 146 ms | 229 ms |
| document built | 140 ms | 140 ms | 146 ms | 229 ms |
| tokenizer attached to editor | 156 ms | 160 ms | 169 ms | 253 ms |
| tabs opened | 144 ms | 145 ms | 153 ms | 238 ms |
| built-in extensions registered | 290 ms | 297 ms | 300 ms | 370 ms |
| frame with file text | 155 ms | 158 ms | 167 ms | 251 ms |
| frame with highlighting | 271 ms | 277 ms | 280 ms | 352 ms |
| extension host up | 524 ms | 545 ms | 604 ms | 1077 ms |
| startup complete | 285 ms | 291 ms | 295 ms | 366 ms |
| to text (black box) | 156 ms | 159 ms | 170 ms | 252 ms |
| to highlight (black box) | 271 ms | 277 ms | 281 ms | 352 ms |
| gap black − white (text) | 1 ms | 2 ms | 3 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 36 ms | 12 ms | 11 ms | 13 ms | 16 ms | 6 ms | 3 ms |
| `medium` | 31 ms | 13 ms | 12 ms | 9 ms | 11 ms | 7 ms | 5 ms |
| `large` | 43 ms | 27 ms | 15 ms | 17 ms | 41 ms | 15 ms | 15 ms |
| `xlarge` | 34 ms | 28 ms | 12 ms | 18 ms | 101 ms | 16 ms | 73 ms |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
