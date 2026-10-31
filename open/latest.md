# File open benchmark

- Recorded: 2026-10-31T22:11:12.466Z, commit `681951a2450d`, diode nightly-681951a
- Machine: INTEL(R) XEON(R) PLATINUM 8573C (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 19 ms; binary floor (`diode --version` over PTY, median): 51 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **116 ms** | 84 ms | 135 ms | 232 ms | 5 ms | 253 MB | 11 |
| `medium` | 126.7 KB | 2000 | **118 ms** | 86 ms | 137 ms | 237 ms | 3 ms | 282 MB | 11 |
| `large` | 1.3 MB | 20000 | **130 ms** | 98 ms | 149 ms | 259 ms | 4 ms | 300 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **207 ms** | 176 ms | 227 ms | 338 ms | 15 ms | 366 MB | 5 |
| `log500m` | 497 MB | 5295839 | **128 ms** | 96 ms | 147 ms | — (plaintext) | 1 ms | 270 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 5 ms | 5 ms | 6 ms | 4 ms |
| node ready (bootstrapComplete) | 56 ms | 56 ms | 54 ms | 61 ms | 53 ms |
| bundle executed (main:start) | 56 ms | 56 ms | 54 ms | 61 ms | 53 ms |
| config loaded | 68 ms | 71 ms | 68 ms | 76 ms | 67 ms |
| keybindings loaded | 68 ms | 72 ms | 68 ms | 77 ms | 67 ms |
| session state loaded | 68 ms | 72 ms | 68 ms | 77 ms | 67 ms |
| extensions scanned | 65 ms | 67 ms | 65 ms | 72 ms | 64 ms |
| themes ready | 72 ms | 76 ms | 72 ms | 80 ms | 71 ms |
| DI container created | 75 ms | 79 ms | 75 ms | 83 ms | 74 ms |
| workbench mounted | 102 ms | 103 ms | 102 ms | 109 ms | 101 ms |
| first frame | 102 ms | 103 ms | 102 ms | 109 ms | 101 ms |
| workbench activated | 106 ms | 107 ms | 106 ms | 114 ms | 105 ms |
| grammars preloaded | 115 ms | 114 ms | 115 ms | 123 ms | 112 ms |
| file read from disk | 118 ms | 117 ms | 128 ms | 206 ms | 119 ms |
| file decoded | 118 ms | 117 ms | 128 ms | 207 ms | 119 ms |
| document built | 118 ms | 117 ms | 128 ms | 207 ms | 119 ms |
| tokenizer attached to editor | 134 ms | 141 ms | 164 ms | 243 ms | — |
| tabs opened | 121 ms | 122 ms | 135 ms | 215 ms | 132 ms |
| built-in extensions registered | 249 ms | 255 ms | 274 ms | 353 ms | 176 ms |
| frame with file text | 132 ms | 135 ms | 147 ms | 226 ms | 146 ms |
| frame with highlighting | 231 ms | 237 ms | 259 ms | 337 ms | — |
| extension host up | 427 ms | 445 ms | 512 ms | 897 ms | 320 ms |
| startup complete | 244 ms | 250 ms | 269 ms | 348 ms | 170 ms |
| to text (black box) | 135 ms | 137 ms | 149 ms | 227 ms | 147 ms |
| to highlight (black box) | 232 ms | 237 ms | 259 ms | 338 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 2 ms | 2 ms | 2 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 25 ms | 9 ms | 7 ms | 8 ms | 15 ms | 6 ms | 3 ms |
| `medium` | 29 ms | 13 ms | 9 ms | 6 ms | 13 ms | 5 ms | 4 ms |
| `large` | 28 ms | 20 ms | 20 ms | 11 ms | 45 ms | 13 ms | 12 ms |
| `xlarge` | 26 ms | 27 ms | 17 ms | 20 ms | 163 ms | 12 ms | 61 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
