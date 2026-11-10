# File open benchmark

- Recorded: 2026-11-10T12:05:55.350Z, commit `b419274a19da`, diode nightly-b419274
- Machine: INTEL(R) XEON(R) PLATINUM 8573C (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 21 ms; binary floor (`diode --version` over PTY, median): 56 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **130 ms** | 95 ms | 151 ms | 245 ms | 9 ms | 264 MB | 11 |
| `medium` | 126.7 KB | 2000 | **129 ms** | 94 ms | 150 ms | 246 ms | 7 ms | 289 MB | 11 |
| `large` | 1.3 MB | 20000 | **144 ms** | 109 ms | 165 ms | 260 ms | 3 ms | 300 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **222 ms** | 187 ms | 243 ms | 324 ms | 4 ms | 350 MB | 5 |
| `log500m` | 497 MB | 5295839 | **141 ms** | 106 ms | 162 ms | — (plaintext) | 5 ms | 308 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 5 ms | 6 ms | 6 ms | 5 ms |
| node ready (bootstrapComplete) | 59 ms | 59 ms | 62 ms | 71 ms | 59 ms |
| bundle executed (main:start) | 59 ms | 59 ms | 62 ms | 71 ms | 59 ms |
| config loaded | 77 ms | 78 ms | 77 ms | 84 ms | 76 ms |
| keybindings loaded | 78 ms | 78 ms | 77 ms | 84 ms | 76 ms |
| session state loaded | 78 ms | 78 ms | 77 ms | 84 ms | 76 ms |
| extensions scanned | 73 ms | 72 ms | 73 ms | 80 ms | 71 ms |
| themes ready | 81 ms | 81 ms | 81 ms | 87 ms | 80 ms |
| DI container created | 84 ms | 83 ms | 85 ms | 92 ms | 83 ms |
| workbench mounted | 115 ms | 114 ms | 115 ms | 125 ms | 113 ms |
| first frame | 115 ms | 114 ms | 115 ms | 125 ms | 113 ms |
| workbench activated | 121 ms | 119 ms | 122 ms | 132 ms | 118 ms |
| grammars preloaded | 130 ms | 127 ms | 130 ms | 141 ms | 121 ms |
| file read from disk | 132 ms | 130 ms | 143 ms | 221 ms | 131 ms |
| file decoded | 132 ms | 130 ms | 143 ms | 221 ms | 131 ms |
| document built | 133 ms | 130 ms | 143 ms | 221 ms | 131 ms |
| tokenizer attached to editor | 150 ms | 151 ms | 165 ms | 243 ms | — |
| tabs opened | 136 ms | 136 ms | 150 ms | 230 ms | 147 ms |
| built-in extensions registered | 268 ms | 266 ms | 280 ms | 342 ms | 198 ms |
| frame with file text | 149 ms | 149 ms | 163 ms | 241 ms | 162 ms |
| frame with highlighting | 245 ms | 245 ms | 260 ms | 324 ms | — |
| extension host up | 465 ms | 480 ms | 544 ms | 945 ms | 365 ms |
| startup complete | 260 ms | 256 ms | 273 ms | 335 ms | 189 ms |
| to text (black box) | 151 ms | 150 ms | 165 ms | 243 ms | 162 ms |
| to highlight (black box) | 245 ms | 246 ms | 260 ms | 324 ms | — |
| gap black − white (text) | 2 ms | 1 ms | 1 ms | 2 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 26 ms | 12 ms | 11 ms | 8 ms | — | 5 ms | 3 ms |
| `medium` failed | 27 ms | 11 ms | 12 ms | 9 ms | — | 6 ms | 5 ms |
| `large` failed | 31 ms | 24 ms | 20 ms | 15 ms | — | 15 ms | 19 ms |
| `xlarge` failed | 42 ms | 34 ms | 23 ms | 50 ms | — | 19 ms | 57 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
