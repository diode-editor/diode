# File open benchmark

- Recorded: 2026-11-19T06:00:15.085Z, commit `73afb28b19e4`, diode nightly-73afb28
- Machine: Intel(R) Xeon(R) 6975P-C (4 cores, 15 GB), linux 7.0.0-1016-aws
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 18 ms; binary floor (`diode --version` over PTY, median): 55 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **124 ms** | 86 ms | 141 ms | 223 ms | 8 ms | 287 MB | 11 |
| `medium` | 126.7 KB | 2000 | **125 ms** | 88 ms | 143 ms | 226 ms | 5 ms | 301 MB | 11 |
| `large` | 1.3 MB | 20000 | **136 ms** | 98 ms | 154 ms | 241 ms | 15 ms | 314 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **200 ms** | 162 ms | 218 ms | 290 ms | 12 ms | 365 MB | 5 |
| `log500m` | 497 MB | 5295839 | **132 ms** | 95 ms | 150 ms | — (plaintext) | 2 ms | 293 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 4 ms | 5 ms | 5 ms | 6 ms | 4 ms |
| node ready (bootstrapComplete) | 56 ms | 57 ms | 59 ms | 65 ms | 55 ms |
| bundle executed (main:start) | 56 ms | 57 ms | 59 ms | 65 ms | 55 ms |
| config loaded | 72 ms | 75 ms | 81 ms | 86 ms | 70 ms |
| keybindings loaded | 72 ms | 77 ms | 81 ms | 86 ms | 70 ms |
| session state loaded | 73 ms | 78 ms | 81 ms | 86 ms | 70 ms |
| extensions scanned | 67 ms | 71 ms | 74 ms | 80 ms | 66 ms |
| themes ready | 76 ms | 80 ms | 84 ms | 88 ms | 73 ms |
| DI container created | 79 ms | 83 ms | 86 ms | 90 ms | 77 ms |
| workbench mounted | 109 ms | 111 ms | 113 ms | 118 ms | 107 ms |
| first frame | 109 ms | 110 ms | 113 ms | 118 ms | 107 ms |
| workbench activated | 115 ms | 116 ms | 119 ms | 124 ms | 113 ms |
| grammars preloaded | 124 ms | 120 ms | 123 ms | 133 ms | 120 ms |
| file read from disk | 125 ms | 124 ms | 132 ms | 194 ms | 128 ms |
| file decoded | 125 ms | 124 ms | 132 ms | 195 ms | 128 ms |
| document built | 125 ms | 124 ms | 132 ms | 195 ms | 128 ms |
| tokenizer attached to editor | 139 ms | 142 ms | 152 ms | 217 ms | — |
| tabs opened | 128 ms | 128 ms | 137 ms | 202 ms | 140 ms |
| built-in extensions registered | 248 ms | 250 ms | 264 ms | 311 ms | 187 ms |
| frame with file text | 139 ms | 139 ms | 150 ms | 215 ms | 150 ms |
| frame with highlighting | 223 ms | 226 ms | 241 ms | 290 ms | — |
| extension host up | 424 ms | 452 ms | 529 ms | 879 ms | 327 ms |
| startup complete | 238 ms | 239 ms | 253 ms | 302 ms | 177 ms |
| to text (black box) | 141 ms | 143 ms | 154 ms | 218 ms | 150 ms |
| to highlight (black box) | 223 ms | 226 ms | 241 ms | 290 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 19 ms | 7 ms | 6 ms | 5 ms | — | 4 ms | 3 ms |
| `medium` failed | 24 ms | 11 ms | 11 ms | 9 ms | — | 4 ms | 4 ms |
| `large` failed | 32 ms | 20 ms | 22 ms | 17 ms | — | 16 ms | 16 ms |
| `xlarge` failed | 36 ms | 30 ms | 17 ms | 13 ms | — | 15 ms | 63 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
