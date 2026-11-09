# File open benchmark

- Recorded: 2026-11-09T00:44:40.780Z, commit `283a30617fdc`, diode nightly-283a306
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 20 ms; binary floor (`diode --version` over PTY, median): 55 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **126 ms** | 92 ms | 147 ms | 232 ms | 8 ms | 272 MB | 11 |
| `medium` | 126.7 KB | 2000 | **128 ms** | 94 ms | 148 ms | 236 ms | 4 ms | 288 MB | 11 |
| `large` | 1.3 MB | 20000 | **139 ms** | 104 ms | 159 ms | 247 ms | 8 ms | 299 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **205 ms** | 170 ms | 225 ms | 303 ms | 4 ms | 352 MB | 5 |
| `log500m` | 497 MB | 5295839 | **140 ms** | 106 ms | 160 ms | — (plaintext) | 6 ms | 279 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 5 ms | 6 ms | 8 ms | 5 ms |
| node ready (bootstrapComplete) | 60 ms | 60 ms | 61 ms | 77 ms | 57 ms |
| bundle executed (main:start) | 60 ms | 60 ms | 61 ms | 77 ms | 57 ms |
| config loaded | 74 ms | 78 ms | 76 ms | 94 ms | 69 ms |
| keybindings loaded | 76 ms | 78 ms | 77 ms | 97 ms | 70 ms |
| session state loaded | 77 ms | 78 ms | 77 ms | 97 ms | 70 ms |
| extensions scanned | 71 ms | 75 ms | 73 ms | 90 ms | 66 ms |
| themes ready | 80 ms | 82 ms | 81 ms | 99 ms | 76 ms |
| DI container created | 83 ms | 85 ms | 84 ms | 102 ms | 80 ms |
| workbench mounted | 113 ms | 113 ms | 114 ms | 129 ms | 109 ms |
| first frame | 113 ms | 113 ms | 114 ms | 129 ms | 109 ms |
| workbench activated | 118 ms | 119 ms | 120 ms | 135 ms | 115 ms |
| grammars preloaded | 128 ms | 127 ms | 124 ms | 139 ms | 122 ms |
| file read from disk | 130 ms | 130 ms | 136 ms | 204 ms | 132 ms |
| file decoded | 130 ms | 130 ms | 136 ms | 204 ms | 132 ms |
| document built | 130 ms | 130 ms | 136 ms | 204 ms | 133 ms |
| tokenizer attached to editor | 146 ms | 149 ms | 160 ms | 227 ms | — |
| tabs opened | 133 ms | 135 ms | 144 ms | 212 ms | 147 ms |
| built-in extensions registered | 254 ms | 259 ms | 269 ms | 325 ms | 199 ms |
| frame with file text | 146 ms | 147 ms | 158 ms | 225 ms | 160 ms |
| frame with highlighting | 232 ms | 236 ms | 247 ms | 303 ms | — |
| extension host up | 449 ms | 488 ms | 546 ms | 924 ms | 346 ms |
| startup complete | 246 ms | 251 ms | 261 ms | 317 ms | 190 ms |
| to text (black box) | 147 ms | 148 ms | 159 ms | 225 ms | 160 ms |
| to highlight (black box) | 232 ms | 236 ms | 247 ms | 303 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 26 ms | 10 ms | 8 ms | 9 ms | — | 3 ms | 3 ms |
| `medium` failed | 28 ms | 12 ms | 8 ms | 7 ms | — | 5 ms | 4 ms |
| `large` failed | 34 ms | 21 ms | 18 ms | 20 ms | — | 25 ms | 18 ms |
| `xlarge` failed | 28 ms | 38 ms | 25 ms | 34 ms | — | 17 ms | 61 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
