# File open benchmark

- Recorded: 2026-11-15T02:42:33.159Z, commit `51e07438c76a`, diode nightly-51e0743
- Machine: AMD EPYC 9V45 96-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 19 ms; binary floor (`diode --version` over PTY, median): 50 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **116 ms** | 85 ms | 135 ms | 211 ms | 5 ms | 273 MB | 11 |
| `medium` | 126.7 KB | 2000 | **119 ms** | 88 ms | 138 ms | 219 ms | 8 ms | 287 MB | 11 |
| `large` | 1.3 MB | 20000 | **131 ms** | 101 ms | 150 ms | 231 ms | 3 ms | 303 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **204 ms** | 174 ms | 224 ms | 292 ms | 6 ms | 357 MB | 5 |
| `log500m` | 497 MB | 5295839 | **129 ms** | 98 ms | 148 ms | — (plaintext) | 4 ms | 314 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 8 ms | 9 ms | 6 ms |
| node ready (bootstrapComplete) | 57 ms | 55 ms | 62 ms | 74 ms | 53 ms |
| bundle executed (main:start) | 57 ms | 56 ms | 62 ms | 74 ms | 53 ms |
| config loaded | 74 ms | 71 ms | 80 ms | 99 ms | 73 ms |
| keybindings loaded | 76 ms | 72 ms | 80 ms | 99 ms | 73 ms |
| session state loaded | 76 ms | 72 ms | 80 ms | 99 ms | 73 ms |
| extensions scanned | 71 ms | 65 ms | 74 ms | 94 ms | 71 ms |
| themes ready | 78 ms | 75 ms | 82 ms | 105 ms | 75 ms |
| DI container created | 81 ms | 77 ms | 85 ms | 107 ms | 78 ms |
| workbench mounted | 105 ms | 106 ms | 110 ms | 135 ms | 105 ms |
| first frame | 104 ms | 106 ms | 110 ms | 135 ms | 105 ms |
| workbench activated | 111 ms | 111 ms | 116 ms | 141 ms | 111 ms |
| grammars preloaded | 116 ms | 116 ms | 122 ms | 144 ms | 113 ms |
| file read from disk | 118 ms | 119 ms | 131 ms | 202 ms | 121 ms |
| file decoded | 118 ms | 119 ms | 131 ms | 202 ms | 121 ms |
| document built | 118 ms | 119 ms | 131 ms | 203 ms | 121 ms |
| tokenizer attached to editor | 132 ms | 138 ms | 151 ms | 224 ms | — |
| tabs opened | 121 ms | 124 ms | 138 ms | 210 ms | 135 ms |
| built-in extensions registered | 233 ms | 238 ms | 252 ms | 313 ms | 179 ms |
| frame with file text | 131 ms | 136 ms | 149 ms | 221 ms | 148 ms |
| frame with highlighting | 211 ms | 218 ms | 231 ms | 292 ms | — |
| extension host up | 403 ms | 436 ms | 501 ms | 868 ms | 335 ms |
| startup complete | 226 ms | 231 ms | 245 ms | 306 ms | 171 ms |
| to text (black box) | 135 ms | 138 ms | 150 ms | 224 ms | 148 ms |
| to highlight (black box) | 211 ms | 219 ms | 231 ms | 292 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 2 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 17 ms | 9 ms | 8 ms | 9 ms | — | 5 ms | 3 ms |
| `medium` failed | 25 ms | 11 ms | 9 ms | 8 ms | — | 4 ms | 4 ms |
| `large` failed | 33 ms | 20 ms | 18 ms | 16 ms | — | 15 ms | 13 ms |
| `xlarge` failed | 26 ms | 28 ms | 19 ms | 41 ms | — | 21 ms | 59 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
