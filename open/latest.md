# File open benchmark

- Recorded: 2026-10-21T22:23:19.399Z, commit `405918226c44`, diode nightly-4059182
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 24 ms; binary floor (`diode --version` over PTY, median): 58 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **135 ms** | 101 ms | 159 ms | 270 ms | 6 ms | 243 MB | 11 |
| `medium` | 126.7 KB | 2000 | **181 ms** | 147 ms | 205 ms | 324 ms | 17 ms | 262 MB | 11 |
| `large` | 1.3 MB | 20000 | **330 ms** | 297 ms | 354 ms | 459 ms | 42 ms | 299 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **1601 ms** | 1567 ms | 1625 ms | 1796 ms | 24 ms | 504 MB | 5 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` |
| --- | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 7 ms | 7 ms | 11 ms |
| node ready (bootstrapComplete) | 60 ms | 65 ms | 66 ms | 86 ms |
| bundle executed (main:start) | 60 ms | 65 ms | 66 ms | 86 ms |
| config loaded | 79 ms | 83 ms | 88 ms | 109 ms |
| keybindings loaded | 79 ms | 83 ms | 88 ms | 111 ms |
| session state loaded | 80 ms | 84 ms | 88 ms | 111 ms |
| extensions scanned | 76 ms | 81 ms | 83 ms | 104 ms |
| themes ready | 83 ms | 89 ms | 90 ms | 115 ms |
| DI container created | 87 ms | 93 ms | 94 ms | 119 ms |
| workbench mounted | 119 ms | 126 ms | 124 ms | 147 ms |
| first frame | 119 ms | 126 ms | 124 ms | 147 ms |
| workbench activated | 125 ms | 131 ms | 129 ms | 153 ms |
| grammars preloaded | 133 ms | 138 ms | 135 ms | 159 ms |
| file read from disk | 134 ms | 141 ms | 147 ms | 259 ms |
| file decoded | 134 ms | 141 ms | 147 ms | 259 ms |
| document built | 134 ms | 141 ms | 147 ms | 259 ms |
| tokenizer attached to editor | 159 ms | 204 ms | 355 ms | 1627 ms |
| tabs opened | 140 ms | 154 ms | 167 ms | 301 ms |
| built-in extensions registered | 291 ms | 344 ms | 479 ms | 1814 ms |
| frame with file text | 158 ms | 202 ms | 353 ms | 1625 ms |
| frame with highlighting | 270 ms | 323 ms | 459 ms | 1796 ms |
| extension host up | 527 ms | 585 ms | 747 ms | 2365 ms |
| startup complete | 286 ms | 339 ms | 474 ms | 1810 ms |
| to text (black box) | 159 ms | 205 ms | 354 ms | 1625 ms |
| to highlight (black box) | 270 ms | 324 ms | 459 ms | 1796 ms |
| gap black − white (text) | 1 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 52 ms | 15 ms | 11 ms | 9 ms | 19 ms | 7 ms | 4 ms |
| `medium` | 46 ms | 21 ms | 15 ms | 12 ms | 17 ms | 8 ms | 6 ms |
| `large` | 76 ms | 58 ms | 44 ms | 69 ms | 50 ms | 11 ms | 16 ms |
| `xlarge` | 241 ms | 422 ms | 400 ms | 315 ms | 251 ms | 13 ms | 66 ms |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
