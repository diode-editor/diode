# File open benchmark

- Recorded: 2026-10-23T00:43:05.223Z, commit `c1f596fbb45f`, diode nightly-c1f596f
- Machine: AMD EPYC 9V45 96-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 20 ms; binary floor (`diode --version` over PTY, median): 45 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **100 ms** | 75 ms | 120 ms | 199 ms | 9 ms | 245 MB | 11 |
| `medium` | 126.7 KB | 2000 | **123 ms** | 98 ms | 143 ms | 224 ms | 19 ms | 267 MB | 11 |
| `large` | 1.3 MB | 20000 | **206 ms** | 181 ms | 226 ms | 292 ms | 18 ms | 307 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **966 ms** | 942 ms | 987 ms | 1049 ms | 29 ms | 604 MB | 5 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` |
| --- | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 6 ms | 6 ms | 11 ms |
| node ready (bootstrapComplete) | 50 ms | 55 ms | 59 ms | 73 ms |
| bundle executed (main:start) | 50 ms | 55 ms | 59 ms | 73 ms |
| config loaded | 65 ms | 69 ms | 71 ms | 91 ms |
| keybindings loaded | 65 ms | 69 ms | 71 ms | 93 ms |
| session state loaded | 65 ms | 69 ms | 71 ms | 94 ms |
| extensions scanned | 62 ms | 66 ms | 69 ms | 87 ms |
| themes ready | 67 ms | 72 ms | 74 ms | 96 ms |
| DI container created | 70 ms | 75 ms | 77 ms | 98 ms |
| workbench mounted | 91 ms | 99 ms | 98 ms | 117 ms |
| first frame | 91 ms | 99 ms | 98 ms | 117 ms |
| workbench activated | 95 ms | 104 ms | 101 ms | 121 ms |
| grammars preloaded | 103 ms | 110 ms | 109 ms | 128 ms |
| file read from disk | 104 ms | 111 ms | 117 ms | 178 ms |
| file decoded | 104 ms | 111 ms | 117 ms | 178 ms |
| document built | 104 ms | 111 ms | 117 ms | 178 ms |
| tokenizer attached to editor | 119 ms | 146 ms | 228 ms | 986 ms |
| tabs opened | 108 ms | 118 ms | 130 ms | 208 ms |
| built-in extensions registered | 211 ms | 238 ms | 307 ms | 1062 ms |
| frame with file text | 118 ms | 143 ms | 225 ms | 984 ms |
| frame with highlighting | 198 ms | 224 ms | 292 ms | 1049 ms |
| extension host up | 374 ms | 423 ms | 524 ms | 1558 ms |
| startup complete | 209 ms | 234 ms | 303 ms | 1059 ms |
| to text (black box) | 120 ms | 143 ms | 226 ms | 987 ms |
| to highlight (black box) | 199 ms | 224 ms | 292 ms | 1049 ms |
| gap black − white (text) | 1 ms | 1 ms | 2 ms | 3 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 19 ms | 10 ms | 8 ms | 7 ms | 8 ms | 4 ms | 2 ms |
| `medium` | 26 ms | 8 ms | 11 ms | 8 ms | 13 ms | 4 ms | 3 ms |
| `large` | 27 ms | 13 ms | 16 ms | 17 ms | 44 ms | 10 ms | 12 ms |
| `xlarge` | 46 ms | 45 ms | 29 ms | 24 ms | 102 ms | 12 ms | 52 ms |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
