# File open benchmark

- Recorded: 2026-10-23T10:41:19.878Z, commit `a6d697c6fac3`, diode nightly-a6d697c
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 23 ms; binary floor (`diode --version` over PTY, median): 58 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **135 ms** | 101 ms | 158 ms | 268 ms | 11 ms | 244 MB | 11 |
| `medium` | 126.7 KB | 2000 | **159 ms** | 125 ms | 182 ms | 295 ms | 9 ms | 267 MB | 11 |
| `large` | 1.3 MB | 20000 | **293 ms** | 259 ms | 317 ms | 417 ms | 33 ms | 306 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **1414 ms** | 1379 ms | 1437 ms | 1534 ms | 72 ms | 684 MB | 5 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` |
| --- | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 6 ms | 8 ms | 9 ms |
| node ready (bootstrapComplete) | 63 ms | 62 ms | 65 ms | 82 ms |
| bundle executed (main:start) | 63 ms | 62 ms | 65 ms | 82 ms |
| config loaded | 82 ms | 83 ms | 86 ms | 101 ms |
| keybindings loaded | 84 ms | 83 ms | 86 ms | 101 ms |
| session state loaded | 84 ms | 83 ms | 86 ms | 101 ms |
| extensions scanned | 78 ms | 79 ms | 83 ms | 97 ms |
| themes ready | 87 ms | 86 ms | 91 ms | 105 ms |
| DI container created | 90 ms | 89 ms | 95 ms | 110 ms |
| workbench mounted | 121 ms | 118 ms | 122 ms | 142 ms |
| first frame | 121 ms | 118 ms | 122 ms | 142 ms |
| workbench activated | 127 ms | 123 ms | 127 ms | 148 ms |
| grammars preloaded | 136 ms | 133 ms | 132 ms | 158 ms |
| file read from disk | 137 ms | 135 ms | 146 ms | 240 ms |
| file decoded | 137 ms | 135 ms | 146 ms | 240 ms |
| document built | 138 ms | 135 ms | 147 ms | 241 ms |
| tokenizer attached to editor | 158 ms | 181 ms | 319 ms | 1439 ms |
| tabs opened | 142 ms | 144 ms | 161 ms | 275 ms |
| built-in extensions registered | 288 ms | 315 ms | 437 ms | 1552 ms |
| frame with file text | 158 ms | 180 ms | 317 ms | 1437 ms |
| frame with highlighting | 267 ms | 295 ms | 417 ms | 1534 ms |
| extension host up | 518 ms | 563 ms | 724 ms | 2224 ms |
| startup complete | 283 ms | 309 ms | 432 ms | 1547 ms |
| to text (black box) | 158 ms | 182 ms | 317 ms | 1437 ms |
| to highlight (black box) | 268 ms | 295 ms | 417 ms | 1534 ms |
| gap black − white (text) | 1 ms | 1 ms | 1 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 37 ms | 14 ms | 10 ms | 9 ms | 16 ms | 7 ms | 3 ms |
| `medium` | 36 ms | 10 ms | 13 ms | 9 ms | 12 ms | 6 ms | 4 ms |
| `large` | 33 ms | 17 ms | 14 ms | 15 ms | 46 ms | 12 ms | 13 ms |
| `xlarge` | 136 ms | 45 ms | 55 ms | 17 ms | 142 ms | 12 ms | 65 ms |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
