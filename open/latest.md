# File open benchmark

- Recorded: 2026-10-22T06:47:35.933Z, commit `8d96b3d255b8`, diode nightly-8d96b3d
- Machine: AMD EPYC 9V45 96-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 20 ms; binary floor (`diode --version` over PTY, median): 44 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **96 ms** | 72 ms | 116 ms | 192 ms | 5 ms | 244 MB | 11 |
| `medium` | 126.7 KB | 2000 | **116 ms** | 92 ms | 136 ms | 218 ms | 10 ms | 248 MB | 11 |
| `large` | 1.3 MB | 20000 | **208 ms** | 184 ms | 228 ms | 296 ms | 6 ms | 303 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **1027 ms** | 1003 ms | 1047 ms | 1167 ms | 51 ms | 505 MB | 5 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` |
| --- | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 5 ms | 6 ms | 11 ms |
| node ready (bootstrapComplete) | 48 ms | 50 ms | 50 ms | 69 ms |
| bundle executed (main:start) | 48 ms | 50 ms | 50 ms | 69 ms |
| config loaded | 61 ms | 64 ms | 64 ms | 85 ms |
| keybindings loaded | 62 ms | 64 ms | 64 ms | 86 ms |
| session state loaded | 62 ms | 64 ms | 64 ms | 86 ms |
| extensions scanned | 59 ms | 62 ms | 62 ms | 80 ms |
| themes ready | 65 ms | 67 ms | 67 ms | 91 ms |
| DI container created | 68 ms | 70 ms | 70 ms | 94 ms |
| workbench mounted | 88 ms | 88 ms | 86 ms | 114 ms |
| first frame | 87 ms | 88 ms | 86 ms | 114 ms |
| workbench activated | 91 ms | 92 ms | 89 ms | 117 ms |
| grammars preloaded | 99 ms | 99 ms | 95 ms | 125 ms |
| file read from disk | 100 ms | 101 ms | 104 ms | 182 ms |
| file decoded | 100 ms | 101 ms | 104 ms | 182 ms |
| document built | 100 ms | 101 ms | 104 ms | 182 ms |
| tokenizer attached to editor | 115 ms | 136 ms | 230 ms | 1050 ms |
| tabs opened | 103 ms | 107 ms | 117 ms | 211 ms |
| built-in extensions registered | 207 ms | 231 ms | 309 ms | 1179 ms |
| frame with file text | 115 ms | 133 ms | 228 ms | 1047 ms |
| frame with highlighting | 191 ms | 216 ms | 296 ms | 1166 ms |
| extension host up | 367 ms | 401 ms | 502 ms | 1580 ms |
| startup complete | 203 ms | 227 ms | 306 ms | 1176 ms |
| to text (black box) | 116 ms | 136 ms | 228 ms | 1047 ms |
| to highlight (black box) | 192 ms | 218 ms | 296 ms | 1167 ms |
| gap black − white (text) | 1 ms | 3 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 27 ms | 13 ms | 10 ms | 9 ms | 13 ms | 7 ms | 2 ms |
| `medium` | 33 ms | 18 ms | 12 ms | 10 ms | 17 ms | 4 ms | 3 ms |
| `large` | 49 ms | 39 ms | 30 ms | 28 ms | 69 ms | 9 ms | 11 ms |
| `xlarge` | 150 ms | 239 ms | 217 ms | 180 ms | 249 ms | 8 ms | 39 ms |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
