# File open benchmark

- Recorded: 2026-10-23T23:11:48.443Z, commit `67324772f440`, diode nightly-6732477
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 21 ms; binary floor (`diode --version` over PTY, median): 51 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **105 ms** | 75 ms | 126 ms | 209 ms | 6 ms | 245 MB | 11 |
| `medium` | 126.7 KB | 2000 | **104 ms** | 74 ms | 126 ms | 213 ms | 4 ms | 265 MB | 11 |
| `large` | 1.3 MB | 20000 | **121 ms** | 91 ms | 142 ms | 227 ms | 7 ms | 287 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **189 ms** | 159 ms | 210 ms | 289 ms | 7 ms | 464 MB | 5 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` |
| --- | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 6 ms | 7 ms | 8 ms |
| node ready (bootstrapComplete) | 55 ms | 54 ms | 60 ms | 69 ms |
| bundle executed (main:start) | 55 ms | 54 ms | 60 ms | 69 ms |
| config loaded | 70 ms | 71 ms | 72 ms | 84 ms |
| keybindings loaded | 71 ms | 71 ms | 73 ms | 87 ms |
| session state loaded | 71 ms | 71 ms | 73 ms | 87 ms |
| extensions scanned | 66 ms | 66 ms | 70 ms | 80 ms |
| themes ready | 73 ms | 74 ms | 75 ms | 89 ms |
| DI container created | 77 ms | 77 ms | 79 ms | 92 ms |
| workbench mounted | 99 ms | 97 ms | 103 ms | 113 ms |
| first frame | 99 ms | 97 ms | 103 ms | 113 ms |
| workbench activated | 103 ms | 101 ms | 107 ms | 117 ms |
| grammars preloaded | 108 ms | 106 ms | 114 ms | 122 ms |
| file read from disk | 110 ms | 108 ms | 123 ms | 189 ms |
| file decoded | 110 ms | 108 ms | 123 ms | 189 ms |
| document built | 110 ms | 108 ms | 123 ms | 189 ms |
| tokenizer attached to editor | 126 ms | 126 ms | 142 ms | 210 ms |
| tabs opened | 114 ms | 114 ms | 130 ms | 197 ms |
| built-in extensions registered | 224 ms | 228 ms | 243 ms | 305 ms |
| frame with file text | 126 ms | 125 ms | 140 ms | 208 ms |
| frame with highlighting | 209 ms | 213 ms | 227 ms | 289 ms |
| extension host up | 403 ms | 422 ms | 475 ms | 889 ms |
| startup complete | 220 ms | 225 ms | 239 ms | 301 ms |
| to text (black box) | 126 ms | 126 ms | 142 ms | 210 ms |
| to highlight (black box) | 209 ms | 213 ms | 227 ms | 289 ms |
| gap black − white (text) | 1 ms | 2 ms | 2 ms | 2 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 30 ms | 11 ms | 8 ms | 8 ms | 11 ms | 4 ms | 2 ms |
| `medium` | 28 ms | 10 ms | 9 ms | 8 ms | 8 ms | 5 ms | 3 ms |
| `large` | 34 ms | 17 ms | 15 ms | 16 ms | 37 ms | 10 ms | 11 ms |
| `xlarge` | 31 ms | 22 ms | 11 ms | 15 ms | 134 ms | 10 ms | 55 ms |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
