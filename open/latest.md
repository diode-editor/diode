# File open benchmark

- Recorded: 2026-11-10T03:33:52.601Z, commit `e03f2ec72392`, diode nightly-e03f2ec
- Machine: AMD EPYC 9V45 96-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 20 ms; binary floor (`diode --version` over PTY, median): 51 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **121 ms** | 90 ms | 141 ms | 221 ms | 4 ms | 270 MB | 11 |
| `medium` | 126.7 KB | 2000 | **123 ms** | 92 ms | 143 ms | 222 ms | 9 ms | 289 MB | 11 |
| `large` | 1.3 MB | 20000 | **133 ms** | 102 ms | 153 ms | 233 ms | 11 ms | 300 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **197 ms** | 166 ms | 217 ms | 293 ms | 12 ms | 358 MB | 5 |
| `log500m` | 497 MB | 5295839 | **127 ms** | 96 ms | 147 ms | — (plaintext) | 2 ms | 312 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 6 ms | 8 ms | 9 ms | 5 ms |
| node ready (bootstrapComplete) | 55 ms | 58 ms | 63 ms | 73 ms | 51 ms |
| bundle executed (main:start) | 55 ms | 58 ms | 63 ms | 73 ms | 51 ms |
| config loaded | 70 ms | 73 ms | 77 ms | 93 ms | 73 ms |
| keybindings loaded | 71 ms | 74 ms | 77 ms | 95 ms | 73 ms |
| session state loaded | 71 ms | 74 ms | 77 ms | 95 ms | 73 ms |
| extensions scanned | 67 ms | 70 ms | 74 ms | 90 ms | 71 ms |
| themes ready | 74 ms | 76 ms | 80 ms | 98 ms | 76 ms |
| DI container created | 78 ms | 79 ms | 83 ms | 101 ms | 78 ms |
| workbench mounted | 106 ms | 106 ms | 111 ms | 130 ms | 105 ms |
| first frame | 106 ms | 106 ms | 111 ms | 129 ms | 105 ms |
| workbench activated | 113 ms | 112 ms | 118 ms | 136 ms | 111 ms |
| grammars preloaded | 120 ms | 120 ms | 127 ms | 140 ms | 112 ms |
| file read from disk | 122 ms | 122 ms | 135 ms | 195 ms | 120 ms |
| file decoded | 122 ms | 122 ms | 135 ms | 195 ms | 120 ms |
| document built | 122 ms | 123 ms | 135 ms | 196 ms | 120 ms |
| tokenizer attached to editor | 139 ms | 140 ms | 154 ms | 217 ms | — |
| tabs opened | 126 ms | 127 ms | 141 ms | 203 ms | 134 ms |
| built-in extensions registered | 242 ms | 241 ms | 254 ms | 315 ms | 176 ms |
| frame with file text | 139 ms | 138 ms | 151 ms | 215 ms | 147 ms |
| frame with highlighting | 221 ms | 221 ms | 232 ms | 293 ms | — |
| extension host up | 419 ms | 449 ms | 488 ms | 863 ms | 333 ms |
| startup complete | 235 ms | 234 ms | 246 ms | 308 ms | 169 ms |
| to text (black box) | 141 ms | 143 ms | 153 ms | 217 ms | 147 ms |
| to highlight (black box) | 221 ms | 222 ms | 233 ms | 293 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 1 ms | 2 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 25 ms | 14 ms | 9 ms | 7 ms | — | 5 ms | 3 ms |
| `medium` failed | 24 ms | 15 ms | 9 ms | 8 ms | — | 6 ms | 4 ms |
| `large` failed | 34 ms | 22 ms | 21 ms | 18 ms | — | 19 ms | 14 ms |
| `xlarge` failed | 29 ms | 37 ms | 23 ms | 45 ms | — | 12 ms | 47 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
