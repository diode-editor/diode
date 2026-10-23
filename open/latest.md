# File open benchmark

- Recorded: 2026-10-23T15:27:11.518Z, commit `3cc5d68fe4be`, diode nightly-3cc5d68
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 24 ms; binary floor (`diode --version` over PTY, median): 57 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **135 ms** | 102 ms | 160 ms | 278 ms | 13 ms | 245 MB | 11 |
| `medium` | 126.7 KB | 2000 | **141 ms** | 108 ms | 165 ms | 278 ms | 6 ms | 247 MB | 11 |
| `large` | 1.3 MB | 20000 | **152 ms** | 119 ms | 176 ms | 287 ms | 10 ms | 285 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **238 ms** | 205 ms | 263 ms | 368 ms | 7 ms | 472 MB | 5 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` |
| --- | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 7 ms | 11 ms |
| node ready (bootstrapComplete) | 65 ms | 65 ms | 71 ms | 79 ms |
| bundle executed (main:start) | 65 ms | 65 ms | 71 ms | 79 ms |
| config loaded | 82 ms | 84 ms | 89 ms | 96 ms |
| keybindings loaded | 83 ms | 84 ms | 89 ms | 98 ms |
| session state loaded | 83 ms | 84 ms | 89 ms | 99 ms |
| extensions scanned | 78 ms | 80 ms | 85 ms | 94 ms |
| themes ready | 86 ms | 88 ms | 93 ms | 101 ms |
| DI container created | 91 ms | 93 ms | 98 ms | 108 ms |
| workbench mounted | 123 ms | 124 ms | 129 ms | 136 ms |
| first frame | 123 ms | 124 ms | 129 ms | 136 ms |
| workbench activated | 128 ms | 129 ms | 135 ms | 141 ms |
| grammars preloaded | 139 ms | 139 ms | 141 ms | 146 ms |
| file read from disk | 140 ms | 142 ms | 152 ms | 238 ms |
| file decoded | 140 ms | 142 ms | 152 ms | 238 ms |
| document built | 141 ms | 142 ms | 152 ms | 238 ms |
| tokenizer attached to editor | 160 ms | 164 ms | 178 ms | 264 ms |
| tabs opened | 145 ms | 149 ms | 161 ms | 248 ms |
| built-in extensions registered | 298 ms | 299 ms | 310 ms | 385 ms |
| frame with file text | 159 ms | 163 ms | 176 ms | 262 ms |
| frame with highlighting | 277 ms | 277 ms | 287 ms | 368 ms |
| extension host up | 530 ms | 557 ms | 621 ms | 1089 ms |
| startup complete | 293 ms | 295 ms | 304 ms | 381 ms |
| to text (black box) | 160 ms | 165 ms | 176 ms | 263 ms |
| to highlight (black box) | 278 ms | 278 ms | 287 ms | 368 ms |
| gap black − white (text) | 1 ms | 1 ms | 0 ms | 2 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 35 ms | 11 ms | 10 ms | 10 ms | 17 ms | 10 ms | 5 ms |
| `medium` | 35 ms | 10 ms | 11 ms | 9 ms | 13 ms | 7 ms | 7 ms |
| `large` | 38 ms | 17 ms | 15 ms | 16 ms | 48 ms | 16 ms | 14 ms |
| `xlarge` | 46 ms | 25 ms | 12 ms | 15 ms | 102 ms | 8 ms | 71 ms |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
