# File open benchmark

- Recorded: 2026-10-22T16:52:33.310Z, commit `4c77a38ddc69`, diode nightly-4c77a38
- Machine: AMD EPYC 9V45 96-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 20 ms; binary floor (`diode --version` over PTY, median): 43 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **92 ms** | 69 ms | 112 ms | 192 ms | 11 ms | 244 MB | 11 |
| `medium` | 126.7 KB | 2000 | **114 ms** | 91 ms | 134 ms | 215 ms | 5 ms | 272 MB | 11 |
| `large` | 1.3 MB | 20000 | **264 ms** | 241 ms | 284 ms | 379 ms | 37 ms | 351 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **1098 ms** | 1075 ms | 1118 ms | 1290 ms | 26 ms | 777 MB | 5 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` |
| --- | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 6 ms | 8 ms | 8 ms |
| node ready (bootstrapComplete) | 48 ms | 49 ms | 55 ms | 60 ms |
| bundle executed (main:start) | 48 ms | 49 ms | 55 ms | 60 ms |
| config loaded | 62 ms | 62 ms | 72 ms | 84 ms |
| keybindings loaded | 63 ms | 63 ms | 73 ms | 85 ms |
| session state loaded | 63 ms | 63 ms | 73 ms | 85 ms |
| extensions scanned | 59 ms | 60 ms | 67 ms | 77 ms |
| themes ready | 65 ms | 66 ms | 75 ms | 88 ms |
| DI container created | 68 ms | 68 ms | 79 ms | 92 ms |
| workbench mounted | 84 ms | 86 ms | 99 ms | 113 ms |
| first frame | 84 ms | 86 ms | 99 ms | 113 ms |
| workbench activated | 87 ms | 89 ms | 104 ms | 117 ms |
| grammars preloaded | 94 ms | 95 ms | 107 ms | 121 ms |
| file read from disk | 95 ms | 96 ms | 114 ms | 176 ms |
| file decoded | 95 ms | 96 ms | 115 ms | 176 ms |
| document built | 95 ms | 96 ms | 115 ms | 177 ms |
| tokenizer attached to editor | 112 ms | 134 ms | 283 ms | 1119 ms |
| tabs opened | 99 ms | 103 ms | 130 ms | 204 ms |
| built-in extensions registered | 208 ms | 231 ms | 395 ms | 1305 ms |
| frame with file text | 111 ms | 132 ms | 282 ms | 1117 ms |
| frame with highlighting | 191 ms | 214 ms | 379 ms | 1290 ms |
| extension host up | 370 ms | 405 ms | 620 ms | 1718 ms |
| startup complete | 204 ms | 227 ms | 391 ms | 1302 ms |
| to text (black box) | 112 ms | 134 ms | 284 ms | 1118 ms |
| to highlight (black box) | 192 ms | 215 ms | 379 ms | 1290 ms |
| gap black − white (text) | 1 ms | 1 ms | 2 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 25 ms | 11 ms | 11 ms | 9 ms | 11 ms | 6 ms | 2 ms |
| `medium` | 27 ms | 16 ms | 13 ms | 11 ms | 13 ms | 6 ms | 3 ms |
| `large` | 55 ms | 50 ms | 37 ms | 45 ms | 49 ms | 9 ms | 12 ms |
| `xlarge` | 181 ms | 282 ms | 226 ms | 280 ms | 429 ms | 6 ms | 44 ms |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
