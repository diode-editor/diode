# File open benchmark

- Recorded: 2026-10-23T12:20:19.353Z, commit `cf6f26f53655`, diode nightly-cf6f26f
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 21 ms; binary floor (`diode --version` over PTY, median): 51 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **101 ms** | 72 ms | 123 ms | 213 ms | 4 ms | 249 MB | 11 |
| `medium` | 126.7 KB | 2000 | **127 ms** | 97 ms | 148 ms | 239 ms | 5 ms | 269 MB | 11 |
| `large` | 1.3 MB | 20000 | **231 ms** | 202 ms | 253 ms | 327 ms | 13 ms | 300 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **1095 ms** | 1066 ms | 1117 ms | 1206 ms | 22 ms | 631 MB | 5 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` |
| --- | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 7 ms | 9 ms |
| node ready (bootstrapComplete) | 54 ms | 55 ms | 61 ms | 73 ms |
| bundle executed (main:start) | 54 ms | 55 ms | 61 ms | 73 ms |
| config loaded | 71 ms | 71 ms | 78 ms | 85 ms |
| keybindings loaded | 71 ms | 71 ms | 79 ms | 85 ms |
| session state loaded | 71 ms | 72 ms | 79 ms | 85 ms |
| extensions scanned | 69 ms | 67 ms | 75 ms | 83 ms |
| themes ready | 74 ms | 74 ms | 82 ms | 89 ms |
| DI container created | 77 ms | 78 ms | 86 ms | 92 ms |
| workbench mounted | 97 ms | 99 ms | 107 ms | 116 ms |
| first frame | 97 ms | 99 ms | 107 ms | 116 ms |
| workbench activated | 101 ms | 104 ms | 111 ms | 120 ms |
| grammars preloaded | 105 ms | 110 ms | 116 ms | 128 ms |
| file read from disk | 106 ms | 112 ms | 124 ms | 190 ms |
| file decoded | 106 ms | 112 ms | 124 ms | 190 ms |
| document built | 106 ms | 112 ms | 124 ms | 190 ms |
| tokenizer attached to editor | 122 ms | 149 ms | 252 ms | 1119 ms |
| tabs opened | 110 ms | 117 ms | 131 ms | 196 ms |
| built-in extensions registered | 229 ms | 254 ms | 343 ms | 1221 ms |
| frame with file text | 121 ms | 148 ms | 250 ms | 1117 ms |
| frame with highlighting | 212 ms | 238 ms | 327 ms | 1206 ms |
| extension host up | 408 ms | 463 ms | 592 ms | 1804 ms |
| startup complete | 225 ms | 250 ms | 339 ms | 1217 ms |
| to text (black box) | 123 ms | 148 ms | 253 ms | 1117 ms |
| to highlight (black box) | 213 ms | 239 ms | 327 ms | 1206 ms |
| gap black − white (text) | 2 ms | 2 ms | 2 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 26 ms | 8 ms | 7 ms | 7 ms | 11 ms | 5 ms | 2 ms |
| `medium` | 25 ms | 8 ms | 10 ms | 7 ms | 10 ms | 5 ms | 4 ms |
| `large` | 27 ms | 16 ms | 15 ms | 13 ms | 40 ms | 10 ms | 17 ms |
| `xlarge` | 29 ms | 23 ms | 17 ms | 13 ms | 110 ms | 10 ms | 60 ms |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
