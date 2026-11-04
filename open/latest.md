# File open benchmark

- Recorded: 2026-11-04T00:51:57.069Z, commit `cd0c8d333158`, diode nightly-cd0c8d3
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 21 ms; binary floor (`diode --version` over PTY, median): 55 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **119 ms** | 85 ms | 140 ms | 228 ms | 2 ms | 259 MB | 11 |
| `medium` | 126.7 KB | 2000 | **121 ms** | 87 ms | 143 ms | 231 ms | 3 ms | 283 MB | 11 |
| `large` | 1.3 MB | 20000 | **138 ms** | 105 ms | 160 ms | 250 ms | 10 ms | 296 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **201 ms** | 167 ms | 222 ms | 301 ms | 4 ms | 347 MB | 5 |
| `log500m` | 497 MB | 5295839 | **127 ms** | 93 ms | 149 ms | — (plaintext) | 3 ms | 313 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 7 ms | 7 ms | 5 ms |
| node ready (bootstrapComplete) | 60 ms | 61 ms | 67 ms | 72 ms | 55 ms |
| bundle executed (main:start) | 60 ms | 61 ms | 67 ms | 73 ms | 55 ms |
| config loaded | 75 ms | 79 ms | 82 ms | 89 ms | 74 ms |
| keybindings loaded | 75 ms | 80 ms | 82 ms | 89 ms | 74 ms |
| session state loaded | 75 ms | 80 ms | 82 ms | 89 ms | 74 ms |
| extensions scanned | 72 ms | 76 ms | 77 ms | 86 ms | 72 ms |
| themes ready | 79 ms | 82 ms | 85 ms | 94 ms | 77 ms |
| DI container created | 83 ms | 85 ms | 89 ms | 98 ms | 79 ms |
| workbench mounted | 109 ms | 110 ms | 117 ms | 127 ms | 105 ms |
| first frame | 109 ms | 110 ms | 116 ms | 127 ms | 105 ms |
| workbench activated | 114 ms | 114 ms | 121 ms | 131 ms | 109 ms |
| grammars preloaded | 121 ms | 119 ms | 130 ms | 138 ms | 113 ms |
| file read from disk | 123 ms | 122 ms | 139 ms | 202 ms | 123 ms |
| file decoded | 123 ms | 122 ms | 139 ms | 202 ms | 123 ms |
| document built | 123 ms | 122 ms | 140 ms | 203 ms | 123 ms |
| tokenizer attached to editor | 139 ms | 142 ms | 160 ms | 224 ms | — |
| tabs opened | 127 ms | 128 ms | 146 ms | 211 ms | 138 ms |
| built-in extensions registered | 247 ms | 250 ms | 269 ms | 319 ms | 183 ms |
| frame with file text | 139 ms | 140 ms | 158 ms | 222 ms | 148 ms |
| frame with highlighting | 228 ms | 230 ms | 250 ms | 301 ms | — |
| extension host up | 436 ms | 478 ms | 540 ms | 916 ms | 334 ms |
| startup complete | 242 ms | 245 ms | 265 ms | 315 ms | 177 ms |
| to text (black box) | 140 ms | 143 ms | 160 ms | 222 ms | 149 ms |
| to highlight (black box) | 228 ms | 231 ms | 250 ms | 301 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 29 ms | 10 ms | 7 ms | 7 ms | — | 5 ms | 3 ms |
| `medium` failed | 26 ms | 11 ms | 8 ms | 10 ms | — | 5 ms | 5 ms |
| `large` failed | 36 ms | 22 ms | 15 ms | 17 ms | — | 12 ms | 15 ms |
| `xlarge` failed | 25 ms | 38 ms | 20 ms | 25 ms | — | 8 ms | 63 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
