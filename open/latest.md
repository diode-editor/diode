# File open benchmark

- Recorded: 2026-10-23T18:54:58.996Z, commit `0f5cd424b6cd`, diode nightly-0f5cd42
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 21 ms; binary floor (`diode --version` over PTY, median): 50 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **105 ms** | 76 ms | 126 ms | 222 ms | 5 ms | 240 MB | 11 |
| `medium` | 126.7 KB | 2000 | **110 ms** | 80 ms | 131 ms | 216 ms | 7 ms | 263 MB | 11 |
| `large` | 1.3 MB | 20000 | **118 ms** | 88 ms | 139 ms | 226 ms | 9 ms | 285 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **195 ms** | 165 ms | 216 ms | 302 ms | 18 ms | 462 MB | 5 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` |
| --- | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 6 ms | 10 ms |
| node ready (bootstrapComplete) | 55 ms | 56 ms | 55 ms | 65 ms |
| bundle executed (main:start) | 55 ms | 56 ms | 55 ms | 65 ms |
| config loaded | 69 ms | 70 ms | 74 ms | 80 ms |
| keybindings loaded | 69 ms | 71 ms | 74 ms | 80 ms |
| session state loaded | 69 ms | 72 ms | 74 ms | 81 ms |
| extensions scanned | 68 ms | 67 ms | 71 ms | 78 ms |
| themes ready | 72 ms | 74 ms | 76 ms | 84 ms |
| DI container created | 76 ms | 78 ms | 79 ms | 88 ms |
| workbench mounted | 99 ms | 101 ms | 99 ms | 113 ms |
| first frame | 99 ms | 101 ms | 99 ms | 113 ms |
| workbench activated | 103 ms | 105 ms | 103 ms | 117 ms |
| grammars preloaded | 110 ms | 110 ms | 112 ms | 126 ms |
| file read from disk | 110 ms | 112 ms | 120 ms | 196 ms |
| file decoded | 110 ms | 112 ms | 120 ms | 196 ms |
| document built | 111 ms | 112 ms | 120 ms | 197 ms |
| tokenizer attached to editor | 126 ms | 130 ms | 138 ms | 217 ms |
| tabs opened | 114 ms | 117 ms | 127 ms | 205 ms |
| built-in extensions registered | 236 ms | 232 ms | 243 ms | 318 ms |
| frame with file text | 125 ms | 128 ms | 136 ms | 215 ms |
| frame with highlighting | 222 ms | 215 ms | 226 ms | 302 ms |
| extension host up | 411 ms | 440 ms | 484 ms | 881 ms |
| startup complete | 233 ms | 228 ms | 238 ms | 314 ms |
| to text (black box) | 126 ms | 131 ms | 139 ms | 216 ms |
| to highlight (black box) | 222 ms | 216 ms | 226 ms | 302 ms |
| gap black − white (text) | 1 ms | 2 ms | 2 ms | 2 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 32 ms | 9 ms | 9 ms | 9 ms | 11 ms | 6 ms | 2 ms |
| `medium` | 27 ms | 11 ms | 10 ms | 7 ms | 9 ms | 4 ms | 3 ms |
| `large` | 34 ms | 18 ms | 20 ms | 12 ms | 51 ms | 11 ms | 12 ms |
| `xlarge` | 39 ms | 25 ms | 15 ms | 16 ms | 138 ms | 14 ms | 61 ms |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
