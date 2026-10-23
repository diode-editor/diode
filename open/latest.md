# File open benchmark

- Recorded: 2026-10-23T16:54:27.611Z, commit `25c36c182ec5`, diode nightly-25c36c1
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 23 ms; binary floor (`diode --version` over PTY, median): 59 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **138 ms** | 102 ms | 161 ms | 277 ms | 10 ms | 245 MB | 11 |
| `medium` | 126.7 KB | 2000 | **139 ms** | 103 ms | 162 ms | 274 ms | 6 ms | 247 MB | 11 |
| `large` | 1.3 MB | 20000 | **155 ms** | 119 ms | 178 ms | 292 ms | 11 ms | 288 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **240 ms** | 205 ms | 263 ms | 367 ms | 9 ms | 471 MB | 5 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` |
| --- | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 6 ms | 7 ms | 9 ms |
| node ready (bootstrapComplete) | 67 ms | 65 ms | 67 ms | 72 ms |
| bundle executed (main:start) | 67 ms | 65 ms | 67 ms | 72 ms |
| config loaded | 86 ms | 83 ms | 83 ms | 92 ms |
| keybindings loaded | 87 ms | 83 ms | 84 ms | 93 ms |
| session state loaded | 87 ms | 83 ms | 84 ms | 93 ms |
| extensions scanned | 82 ms | 78 ms | 79 ms | 88 ms |
| themes ready | 89 ms | 86 ms | 88 ms | 96 ms |
| DI container created | 93 ms | 90 ms | 92 ms | 99 ms |
| workbench mounted | 125 ms | 123 ms | 125 ms | 130 ms |
| first frame | 125 ms | 123 ms | 125 ms | 130 ms |
| workbench activated | 131 ms | 128 ms | 130 ms | 136 ms |
| grammars preloaded | 139 ms | 138 ms | 142 ms | 144 ms |
| file read from disk | 140 ms | 140 ms | 153 ms | 236 ms |
| file decoded | 140 ms | 140 ms | 153 ms | 236 ms |
| document built | 141 ms | 140 ms | 154 ms | 236 ms |
| tokenizer attached to editor | 160 ms | 163 ms | 177 ms | 264 ms |
| tabs opened | 145 ms | 147 ms | 162 ms | 246 ms |
| built-in extensions registered | 299 ms | 297 ms | 311 ms | 387 ms |
| frame with file text | 160 ms | 162 ms | 175 ms | 262 ms |
| frame with highlighting | 277 ms | 274 ms | 291 ms | 367 ms |
| extension host up | 535 ms | 556 ms | 624 ms | 1106 ms |
| startup complete | 293 ms | 291 ms | 306 ms | 382 ms |
| to text (black box) | 161 ms | 162 ms | 178 ms | 263 ms |
| to highlight (black box) | 277 ms | 274 ms | 292 ms | 367 ms |
| gap black − white (text) | 1 ms | 1 ms | 2 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 36 ms | 15 ms | 10 ms | 11 ms | 17 ms | 7 ms | 4 ms |
| `medium` | 34 ms | 10 ms | 10 ms | 11 ms | 16 ms | 7 ms | 9 ms |
| `large` | 47 ms | 23 ms | 16 ms | 17 ms | 38 ms | 14 ms | 14 ms |
| `xlarge` | 55 ms | 24 ms | 12 ms | 12 ms | 92 ms | 7 ms | 72 ms |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
