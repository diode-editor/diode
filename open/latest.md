# File open benchmark

- Recorded: 2026-10-24T22:05:22.466Z, commit `2575dcc1d002`, diode nightly-2575dcc
- Machine: INTEL(R) XEON(R) PLATINUM 8573C (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 21 ms; binary floor (`diode --version` over PTY, median): 56 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **114 ms** | 79 ms | 135 ms | 243 ms | 6 ms | 243 MB | 11 |
| `medium` | 126.7 KB | 2000 | **120 ms** | 85 ms | 141 ms | 240 ms | 4 ms | 245 MB | 11 |
| `large` | 1.3 MB | 20000 | **130 ms** | 96 ms | 152 ms | 260 ms | 4 ms | 290 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **216 ms** | 181 ms | 237 ms | 330 ms | 3 ms | 363 MB | 5 |
| `log500m` | 497 MB | 5295839 | **132 ms** | 97 ms | 153 ms | — (plaintext) | 3 ms | 260 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 5 ms | 6 ms | 11 ms | 5 ms |
| node ready (bootstrapComplete) | 54 ms | 56 ms | 58 ms | 65 ms | 55 ms |
| bundle executed (main:start) | 55 ms | 56 ms | 58 ms | 66 ms | 55 ms |
| config loaded | 68 ms | 69 ms | 72 ms | 83 ms | 68 ms |
| keybindings loaded | 68 ms | 69 ms | 72 ms | 84 ms | 69 ms |
| session state loaded | 68 ms | 69 ms | 72 ms | 84 ms | 69 ms |
| extensions scanned | 66 ms | 67 ms | 69 ms | 81 ms | 65 ms |
| themes ready | 72 ms | 74 ms | 76 ms | 88 ms | 72 ms |
| DI container created | 75 ms | 77 ms | 79 ms | 91 ms | 76 ms |
| workbench mounted | 102 ms | 104 ms | 105 ms | 116 ms | 102 ms |
| first frame | 102 ms | 104 ms | 105 ms | 116 ms | 102 ms |
| workbench activated | 107 ms | 108 ms | 110 ms | 120 ms | 107 ms |
| grammars preloaded | 116 ms | 118 ms | 117 ms | 124 ms | 114 ms |
| file read from disk | 118 ms | 121 ms | 129 ms | 216 ms | 124 ms |
| file decoded | 118 ms | 121 ms | 129 ms | 217 ms | 124 ms |
| document built | 118 ms | 121 ms | 130 ms | 217 ms | 124 ms |
| tokenizer attached to editor | 134 ms | 140 ms | 151 ms | 238 ms | — |
| tabs opened | 121 ms | 126 ms | 137 ms | 225 ms | 141 ms |
| built-in extensions registered | 256 ms | 256 ms | 274 ms | 344 ms | 183 ms |
| frame with file text | 133 ms | 139 ms | 150 ms | 236 ms | 153 ms |
| frame with highlighting | 243 ms | 240 ms | 259 ms | 330 ms | — |
| extension host up | 438 ms | 447 ms | 515 ms | 829 ms | 336 ms |
| startup complete | 253 ms | 251 ms | 270 ms | 339 ms | 177 ms |
| to text (black box) | 135 ms | 141 ms | 152 ms | 237 ms | 153 ms |
| to highlight (black box) | 243 ms | 240 ms | 260 ms | 330 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 2 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 32 ms | 12 ms | 8 ms | 9 ms | 13 ms | 5 ms | 3 ms |
| `medium` | 31 ms | 11 ms | 10 ms | 8 ms | 12 ms | 6 ms | 3 ms |
| `large` | 37 ms | 23 ms | 19 ms | 16 ms | 39 ms | 21 ms | 14 ms |
| `xlarge` | 24 ms | 26 ms | 13 ms | 15 ms | 107 ms | 10 ms | 62 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
