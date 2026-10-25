# File open benchmark

- Recorded: 2026-10-25T12:39:46.263Z, commit `5d6fa1b32850`, diode nightly-5d6fa1b
- Machine: Intel(R) Xeon(R) 6973P-C (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 19 ms; binary floor (`diode --version` over PTY, median): 47 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **103 ms** | 75 ms | 122 ms | 206 ms | 5 ms | 244 MB | 11 |
| `medium` | 126.7 KB | 2000 | **107 ms** | 79 ms | 126 ms | 219 ms | 14 ms | 263 MB | 11 |
| `large` | 1.3 MB | 20000 | **115 ms** | 88 ms | 135 ms | 222 ms | 9 ms | 292 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **208 ms** | 180 ms | 227 ms | 303 ms | 27 ms | 360 MB | 5 |
| `log500m` | 497 MB | 5295839 | **105 ms** | 78 ms | 125 ms | — (plaintext) | 3 ms | 264 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 5 ms | 6 ms | 8 ms | 4 ms |
| node ready (bootstrapComplete) | 50 ms | 54 ms | 53 ms | 60 ms | 47 ms |
| bundle executed (main:start) | 50 ms | 54 ms | 54 ms | 60 ms | 47 ms |
| config loaded | 64 ms | 69 ms | 65 ms | 76 ms | 59 ms |
| keybindings loaded | 64 ms | 69 ms | 66 ms | 76 ms | 59 ms |
| session state loaded | 64 ms | 69 ms | 66 ms | 76 ms | 60 ms |
| extensions scanned | 61 ms | 66 ms | 64 ms | 73 ms | 56 ms |
| themes ready | 67 ms | 72 ms | 69 ms | 79 ms | 63 ms |
| DI container created | 70 ms | 76 ms | 72 ms | 82 ms | 66 ms |
| workbench mounted | 93 ms | 97 ms | 93 ms | 105 ms | 87 ms |
| first frame | 93 ms | 97 ms | 93 ms | 105 ms | 87 ms |
| workbench activated | 97 ms | 101 ms | 97 ms | 109 ms | 91 ms |
| grammars preloaded | 105 ms | 105 ms | 107 ms | 118 ms | 97 ms |
| file read from disk | 107 ms | 107 ms | 116 ms | 203 ms | 105 ms |
| file decoded | 107 ms | 108 ms | 116 ms | 203 ms | 105 ms |
| document built | 107 ms | 108 ms | 116 ms | 203 ms | 105 ms |
| tokenizer attached to editor | 120 ms | 127 ms | 133 ms | 227 ms | — |
| tabs opened | 109 ms | 113 ms | 121 ms | 212 ms | 116 ms |
| built-in extensions registered | 218 ms | 236 ms | 234 ms | 316 ms | 151 ms |
| frame with file text | 119 ms | 125 ms | 132 ms | 225 ms | 124 ms |
| frame with highlighting | 205 ms | 219 ms | 221 ms | 303 ms | — |
| extension host up | 375 ms | 423 ms | 439 ms | 770 ms | 283 ms |
| startup complete | 214 ms | 232 ms | 230 ms | 312 ms | 147 ms |
| to text (black box) | 122 ms | 126 ms | 135 ms | 227 ms | 125 ms |
| to highlight (black box) | 206 ms | 219 ms | 222 ms | 303 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 3 ms | 2 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 24 ms | 11 ms | 9 ms | 6 ms | 7 ms | 4 ms | 3 ms |
| `medium` | 29 ms | 10 ms | 8 ms | 6 ms | 12 ms | 4 ms | 4 ms |
| `large` | 30 ms | 19 ms | 14 ms | 12 ms | 40 ms | 10 ms | 11 ms |
| `xlarge` | 25 ms | 22 ms | 12 ms | 17 ms | 134 ms | 11 ms | 68 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
