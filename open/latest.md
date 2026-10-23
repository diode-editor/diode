# File open benchmark

- Recorded: 2026-10-23T14:37:34.728Z, commit `0754b9e9e392`, diode nightly-0754b9e
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 28 ms; binary floor (`diode --version` over PTY, median): 63 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **131 ms** | 96 ms | 159 ms | 274 ms | 4 ms | 244 MB | 11 |
| `medium` | 126.7 KB | 2000 | **140 ms** | 105 ms | 168 ms | 286 ms | 8 ms | 248 MB | 11 |
| `large` | 1.3 MB | 20000 | **158 ms** | 123 ms | 186 ms | 300 ms | 20 ms | 309 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **229 ms** | 194 ms | 257 ms | 362 ms | 5 ms | 575 MB | 5 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` |
| --- | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 8 ms | 7 ms | 12 ms | 10 ms |
| node ready (bootstrapComplete) | 70 ms | 71 ms | 87 ms | 79 ms |
| bundle executed (main:start) | 70 ms | 72 ms | 87 ms | 79 ms |
| config loaded | 87 ms | 92 ms | 107 ms | 104 ms |
| keybindings loaded | 89 ms | 92 ms | 108 ms | 104 ms |
| session state loaded | 89 ms | 92 ms | 108 ms | 105 ms |
| extensions scanned | 85 ms | 88 ms | 103 ms | 100 ms |
| themes ready | 92 ms | 95 ms | 112 ms | 109 ms |
| DI container created | 98 ms | 101 ms | 115 ms | 112 ms |
| workbench mounted | 125 ms | 130 ms | 141 ms | 139 ms |
| first frame | 125 ms | 129 ms | 141 ms | 139 ms |
| workbench activated | 130 ms | 135 ms | 147 ms | 144 ms |
| grammars preloaded | 141 ms | 141 ms | 152 ms | 150 ms |
| file read from disk | 142 ms | 143 ms | 162 ms | 234 ms |
| file decoded | 142 ms | 144 ms | 162 ms | 234 ms |
| document built | 142 ms | 144 ms | 163 ms | 234 ms |
| tokenizer attached to editor | 159 ms | 169 ms | 185 ms | 259 ms |
| tabs opened | 146 ms | 151 ms | 171 ms | 243 ms |
| built-in extensions registered | 294 ms | 307 ms | 317 ms | 380 ms |
| frame with file text | 158 ms | 167 ms | 184 ms | 257 ms |
| frame with highlighting | 274 ms | 286 ms | 297 ms | 362 ms |
| extension host up | 523 ms | 569 ms | 646 ms | 1268 ms |
| startup complete | 289 ms | 302 ms | 312 ms | 375 ms |
| to text (black box) | 159 ms | 168 ms | 186 ms | 257 ms |
| to highlight (black box) | 274 ms | 286 ms | 300 ms | 362 ms |
| gap black − white (text) | 1 ms | 1 ms | 1 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 30 ms | 10 ms | 11 ms | 11 ms | 15 ms | 6 ms | 3 ms |
| `medium` | 36 ms | 12 ms | 10 ms | 11 ms | 15 ms | 7 ms | 4 ms |
| `large` | 36 ms | 21 ms | 16 ms | 16 ms | 51 ms | 14 ms | 17 ms |
| `xlarge` | 34 ms | 37 ms | 17 ms | 20 ms | 121 ms | 14 ms | 64 ms |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
