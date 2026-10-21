# File open benchmark

- Recorded: 2026-10-21T20:54:55.735Z, commit `3f620fe2f1ff`, diode nightly-3f620fe
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 24 ms; binary floor (`diode --version` over PTY, median): 57 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **133 ms** | 101 ms | 158 ms | 269 ms | 7 ms | 244 MB | 11 |
| `medium` | 126.7 KB | 2000 | **167 ms** | 134 ms | 192 ms | 305 ms | 8 ms | 250 MB | 11 |
| `large` | 1.3 MB | 20000 | **314 ms** | 282 ms | 339 ms | 448 ms | 28 ms | 300 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **1577 ms** | 1544 ms | 1601 ms | 1760 ms | 57 ms | 509 MB | 5 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` |
| --- | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 8 ms | 6 ms | 8 ms |
| node ready (bootstrapComplete) | 62 ms | 63 ms | 66 ms | 86 ms |
| bundle executed (main:start) | 62 ms | 63 ms | 66 ms | 86 ms |
| config loaded | 79 ms | 79 ms | 86 ms | 107 ms |
| keybindings loaded | 81 ms | 80 ms | 87 ms | 111 ms |
| session state loaded | 82 ms | 80 ms | 87 ms | 111 ms |
| extensions scanned | 76 ms | 76 ms | 82 ms | 103 ms |
| themes ready | 85 ms | 83 ms | 89 ms | 114 ms |
| DI container created | 88 ms | 88 ms | 93 ms | 118 ms |
| workbench mounted | 118 ms | 118 ms | 120 ms | 144 ms |
| first frame | 117 ms | 118 ms | 120 ms | 144 ms |
| workbench activated | 123 ms | 123 ms | 125 ms | 149 ms |
| grammars preloaded | 133 ms | 133 ms | 131 ms | 155 ms |
| file read from disk | 134 ms | 136 ms | 142 ms | 254 ms |
| file decoded | 134 ms | 136 ms | 142 ms | 254 ms |
| document built | 134 ms | 136 ms | 142 ms | 254 ms |
| tokenizer attached to editor | 158 ms | 189 ms | 340 ms | 1603 ms |
| tabs opened | 139 ms | 145 ms | 161 ms | 297 ms |
| built-in extensions registered | 291 ms | 324 ms | 466 ms | 1778 ms |
| frame with file text | 157 ms | 187 ms | 339 ms | 1601 ms |
| frame with highlighting | 268 ms | 304 ms | 448 ms | 1760 ms |
| extension host up | 515 ms | 566 ms | 744 ms | 2346 ms |
| startup complete | 285 ms | 319 ms | 461 ms | 1774 ms |
| to text (black box) | 158 ms | 192 ms | 339 ms | 1601 ms |
| to highlight (black box) | 269 ms | 305 ms | 448 ms | 1760 ms |
| gap black − white (text) | 1 ms | 3 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 45 ms | 14 ms | 12 ms | 9 ms | 17 ms | 9 ms | 4 ms |
| `medium` | 39 ms | 17 ms | 14 ms | 15 ms | 17 ms | 6 ms | 6 ms |
| `large` | 62 ms | 59 ms | 48 ms | 52 ms | 51 ms | 12 ms | 14 ms |
| `xlarge` | 243 ms | 466 ms | 406 ms | 293 ms | 340 ms | 8 ms | 70 ms |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
