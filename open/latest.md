# File open benchmark

- Recorded: 2026-10-23T10:30:35.429Z, commit `dfe54142450a`, diode nightly-dfe5414
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 20 ms; binary floor (`diode --version` over PTY, median): 50 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **102 ms** | 73 ms | 122 ms | 207 ms | 5 ms | 245 MB | 11 |
| `medium` | 126.7 KB | 2000 | **126 ms** | 97 ms | 146 ms | 232 ms | 11 ms | 267 MB | 11 |
| `large` | 1.3 MB | 20000 | **236 ms** | 206 ms | 255 ms | 327 ms | 14 ms | 301 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **1108 ms** | 1078 ms | 1128 ms | 1200 ms | 16 ms | 585 MB | 5 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` |
| --- | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 5 ms | 6 ms | 9 ms |
| node ready (bootstrapComplete) | 52 ms | 55 ms | 58 ms | 61 ms |
| bundle executed (main:start) | 52 ms | 55 ms | 58 ms | 61 ms |
| config loaded | 67 ms | 70 ms | 72 ms | 76 ms |
| keybindings loaded | 68 ms | 70 ms | 74 ms | 78 ms |
| session state loaded | 68 ms | 70 ms | 74 ms | 78 ms |
| extensions scanned | 65 ms | 67 ms | 70 ms | 74 ms |
| themes ready | 70 ms | 73 ms | 76 ms | 81 ms |
| DI container created | 73 ms | 77 ms | 79 ms | 87 ms |
| workbench mounted | 95 ms | 97 ms | 102 ms | 111 ms |
| first frame | 95 ms | 97 ms | 102 ms | 111 ms |
| workbench activated | 99 ms | 101 ms | 105 ms | 115 ms |
| grammars preloaded | 104 ms | 107 ms | 114 ms | 123 ms |
| file read from disk | 104 ms | 109 ms | 122 ms | 184 ms |
| file decoded | 104 ms | 109 ms | 122 ms | 184 ms |
| document built | 105 ms | 109 ms | 123 ms | 184 ms |
| tokenizer attached to editor | 120 ms | 146 ms | 255 ms | 1129 ms |
| tabs opened | 108 ms | 115 ms | 133 ms | 212 ms |
| built-in extensions registered | 223 ms | 249 ms | 342 ms | 1214 ms |
| frame with file text | 120 ms | 144 ms | 253 ms | 1128 ms |
| frame with highlighting | 206 ms | 231 ms | 327 ms | 1200 ms |
| extension host up | 402 ms | 441 ms | 570 ms | 1770 ms |
| startup complete | 218 ms | 245 ms | 339 ms | 1211 ms |
| to text (black box) | 122 ms | 146 ms | 255 ms | 1128 ms |
| to highlight (black box) | 207 ms | 232 ms | 327 ms | 1200 ms |
| gap black − white (text) | 2 ms | 2 ms | 2 ms | 2 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 26 ms | 10 ms | 7 ms | 6 ms | 10 ms | 4 ms | 3 ms |
| `medium` | 31 ms | 9 ms | 9 ms | 7 ms | 12 ms | 5 ms | 3 ms |
| `large` | 28 ms | 16 ms | 16 ms | 11 ms | 40 ms | 10 ms | 14 ms |
| `xlarge` | 28 ms | 39 ms | 38 ms | 14 ms | 99 ms | 11 ms | 55 ms |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
