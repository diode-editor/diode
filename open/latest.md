# File open benchmark

- Recorded: 2026-10-22T00:27:19.790Z, commit `f43996f0bca5`, diode nightly-f43996f
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 58 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **139 ms** | 106 ms | 164 ms | 287 ms | 23 ms | 244 MB | 11 |
| `medium` | 126.7 KB | 2000 | **173 ms** | 141 ms | 198 ms | 318 ms | 6 ms | 247 MB | 11 |
| `large` | 1.3 MB | 20000 | **325 ms** | 292 ms | 350 ms | 456 ms | 12 ms | 299 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **1537 ms** | 1504 ms | 1562 ms | 1749 ms | 74 ms | 500 MB | 5 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` |
| --- | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 6 ms | 7 ms | 8 ms |
| node ready (bootstrapComplete) | 66 ms | 64 ms | 69 ms | 69 ms |
| bundle executed (main:start) | 66 ms | 64 ms | 69 ms | 69 ms |
| config loaded | 87 ms | 82 ms | 87 ms | 98 ms |
| keybindings loaded | 88 ms | 82 ms | 89 ms | 99 ms |
| session state loaded | 88 ms | 82 ms | 89 ms | 99 ms |
| extensions scanned | 82 ms | 78 ms | 84 ms | 92 ms |
| themes ready | 90 ms | 86 ms | 92 ms | 102 ms |
| DI container created | 94 ms | 91 ms | 97 ms | 106 ms |
| workbench mounted | 123 ms | 122 ms | 127 ms | 136 ms |
| first frame | 123 ms | 122 ms | 127 ms | 136 ms |
| workbench activated | 129 ms | 128 ms | 132 ms | 142 ms |
| grammars preloaded | 137 ms | 138 ms | 143 ms | 148 ms |
| file read from disk | 138 ms | 141 ms | 154 ms | 248 ms |
| file decoded | 138 ms | 141 ms | 154 ms | 248 ms |
| document built | 138 ms | 141 ms | 155 ms | 248 ms |
| tokenizer attached to editor | 163 ms | 198 ms | 349 ms | 1563 ms |
| tabs opened | 143 ms | 151 ms | 173 ms | 289 ms |
| built-in extensions registered | 308 ms | 337 ms | 477 ms | 1768 ms |
| frame with file text | 162 ms | 196 ms | 347 ms | 1561 ms |
| frame with highlighting | 286 ms | 318 ms | 456 ms | 1749 ms |
| extension host up | 541 ms | 578 ms | 746 ms | 2329 ms |
| startup complete | 302 ms | 333 ms | 472 ms | 1763 ms |
| to text (black box) | 164 ms | 198 ms | 350 ms | 1562 ms |
| to highlight (black box) | 287 ms | 318 ms | 456 ms | 1749 ms |
| gap black − white (text) | 2 ms | 2 ms | 2 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 48 ms | 14 ms | 14 ms | 9 ms | 17 ms | 10 ms | 6 ms |
| `medium` | 51 ms | 18 ms | 13 ms | 11 ms | 17 ms | 8 ms | 5 ms |
| `large` | 83 ms | 55 ms | 46 ms | 82 ms | 58 ms | 15 ms | 18 ms |
| `xlarge` | 233 ms | 433 ms | 471 ms | 322 ms | 323 ms | 11 ms | 71 ms |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
