# File open benchmark

- Recorded: 2026-11-06T01:31:09.401Z, commit `16044af57d92`, diode nightly-16044af
- Machine: AMD EPYC 9V45 96-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 18 ms; binary floor (`diode --version` over PTY, median): 47 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **106 ms** | 77 ms | 124 ms | 202 ms | 4 ms | 267 MB | 11 |
| `medium` | 126.7 KB | 2000 | **107 ms** | 78 ms | 125 ms | 200 ms | 6 ms | 284 MB | 11 |
| `large` | 1.3 MB | 20000 | **121 ms** | 92 ms | 139 ms | 215 ms | 11 ms | 298 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **172 ms** | 143 ms | 190 ms | 258 ms | 17 ms | 355 MB | 5 |
| `log500m` | 497 MB | 5295839 | **101 ms** | 72 ms | 119 ms | — (plaintext) | 6 ms | 315 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 8 ms | 10 ms | 5 ms |
| node ready (bootstrapComplete) | 53 ms | 51 ms | 58 ms | 67 ms | 46 ms |
| bundle executed (main:start) | 53 ms | 51 ms | 58 ms | 67 ms | 46 ms |
| config loaded | 67 ms | 65 ms | 71 ms | 88 ms | 62 ms |
| keybindings loaded | 67 ms | 65 ms | 72 ms | 88 ms | 62 ms |
| session state loaded | 68 ms | 66 ms | 72 ms | 88 ms | 62 ms |
| extensions scanned | 63 ms | 62 ms | 69 ms | 85 ms | 58 ms |
| themes ready | 71 ms | 69 ms | 75 ms | 91 ms | 64 ms |
| DI container created | 74 ms | 72 ms | 78 ms | 93 ms | 67 ms |
| workbench mounted | 96 ms | 95 ms | 100 ms | 114 ms | 85 ms |
| first frame | 96 ms | 95 ms | 100 ms | 114 ms | 85 ms |
| workbench activated | 100 ms | 98 ms | 104 ms | 117 ms | 88 ms |
| grammars preloaded | 106 ms | 104 ms | 112 ms | 120 ms | 90 ms |
| file read from disk | 108 ms | 106 ms | 120 ms | 171 ms | 98 ms |
| file decoded | 108 ms | 106 ms | 120 ms | 171 ms | 98 ms |
| document built | 109 ms | 106 ms | 121 ms | 172 ms | 98 ms |
| tokenizer attached to editor | 123 ms | 124 ms | 141 ms | 192 ms | — |
| tabs opened | 113 ms | 111 ms | 127 ms | 179 ms | 110 ms |
| built-in extensions registered | 222 ms | 220 ms | 233 ms | 277 ms | 152 ms |
| frame with file text | 123 ms | 122 ms | 138 ms | 190 ms | 119 ms |
| frame with highlighting | 202 ms | 200 ms | 215 ms | 258 ms | — |
| extension host up | 391 ms | 403 ms | 453 ms | 791 ms | 298 ms |
| startup complete | 215 ms | 213 ms | 227 ms | 271 ms | 144 ms |
| to text (black box) | 124 ms | 125 ms | 139 ms | 190 ms | 119 ms |
| to highlight (black box) | 202 ms | 200 ms | 215 ms | 258 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 2 ms | 2 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 11 ms | 8 ms | 8 ms | 8 ms | — | 4 ms | 2 ms |
| `medium` failed | 25 ms | 12 ms | 8 ms | 7 ms | — | 6 ms | 4 ms |
| `large` failed | 29 ms | 19 ms | 15 ms | 11 ms | — | 11 ms | 14 ms |
| `xlarge` failed | 28 ms | 29 ms | 14 ms | 28 ms | — | 14 ms | 40 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
