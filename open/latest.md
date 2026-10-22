# File open benchmark

- Recorded: 2026-10-22T22:56:20.450Z, commit `5ff4628e5eb2`, diode nightly-5ff4628
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 23 ms; binary floor (`diode --version` over PTY, median): 59 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **139 ms** | 104 ms | 163 ms | 288 ms | 9 ms | 244 MB | 11 |
| `medium` | 126.7 KB | 2000 | **174 ms** | 138 ms | 198 ms | 321 ms | 7 ms | 269 MB | 11 |
| `large` | 1.3 MB | 20000 | **340 ms** | 304 ms | 363 ms | 499 ms | 22 ms | 331 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **1674 ms** | 1638 ms | 1697 ms | 1972 ms | 30 ms | 739 MB | 5 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` |
| --- | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 7 ms | 8 ms |
| node ready (bootstrapComplete) | 66 ms | 64 ms | 67 ms | 86 ms |
| bundle executed (main:start) | 66 ms | 64 ms | 67 ms | 86 ms |
| config loaded | 85 ms | 82 ms | 84 ms | 108 ms |
| keybindings loaded | 87 ms | 85 ms | 84 ms | 109 ms |
| session state loaded | 87 ms | 85 ms | 84 ms | 109 ms |
| extensions scanned | 82 ms | 79 ms | 80 ms | 105 ms |
| themes ready | 90 ms | 88 ms | 88 ms | 117 ms |
| DI container created | 93 ms | 93 ms | 93 ms | 121 ms |
| workbench mounted | 121 ms | 121 ms | 125 ms | 155 ms |
| first frame | 121 ms | 121 ms | 125 ms | 155 ms |
| workbench activated | 127 ms | 127 ms | 130 ms | 161 ms |
| grammars preloaded | 135 ms | 133 ms | 138 ms | 169 ms |
| file read from disk | 136 ms | 135 ms | 153 ms | 255 ms |
| file decoded | 136 ms | 135 ms | 153 ms | 255 ms |
| document built | 137 ms | 135 ms | 154 ms | 255 ms |
| tokenizer attached to editor | 162 ms | 197 ms | 364 ms | 1699 ms |
| tabs opened | 142 ms | 145 ms | 173 ms | 293 ms |
| built-in extensions registered | 307 ms | 341 ms | 519 ms | 1990 ms |
| frame with file text | 161 ms | 195 ms | 362 ms | 1697 ms |
| frame with highlighting | 287 ms | 320 ms | 499 ms | 1972 ms |
| extension host up | 536 ms | 579 ms | 795 ms | 2613 ms |
| startup complete | 302 ms | 335 ms | 512 ms | 1986 ms |
| to text (black box) | 163 ms | 198 ms | 363 ms | 1697 ms |
| to highlight (black box) | 288 ms | 321 ms | 499 ms | 1972 ms |
| gap black − white (text) | 1 ms | 2 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 47 ms | 14 ms | 12 ms | 11 ms | 18 ms | 12 ms | 4 ms |
| `medium` | 45 ms | 22 ms | 16 ms | 14 ms | 20 ms | 7 ms | 7 ms |
| `large` | 85 ms | 79 ms | 63 ms | 74 ms | 66 ms | 16 ms | 20 ms |
| `xlarge` | 328 ms | 513 ms | 501 ms | 429 ms | 470 ms | 11 ms | 69 ms |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
