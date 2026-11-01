# File open benchmark

- Recorded: 2026-11-01T07:28:08.257Z, commit `5e09838bdac2`, diode nightly-5e09838
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 21 ms; binary floor (`diode --version` over PTY, median): 53 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **113 ms** | 81 ms | 133 ms | 218 ms | 8 ms | 256 MB | 11 |
| `medium` | 126.7 KB | 2000 | **119 ms** | 87 ms | 140 ms | 232 ms | 3 ms | 284 MB | 11 |
| `large` | 1.3 MB | 20000 | **124 ms** | 92 ms | 145 ms | 246 ms | 5 ms | 298 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **214 ms** | 182 ms | 235 ms | 338 ms | 10 ms | 375 MB | 5 |
| `log500m` | 497 MB | 5295839 | **128 ms** | 96 ms | 148 ms | — (plaintext) | 6 ms | 272 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 6 ms | 7 ms | 5 ms |
| node ready (bootstrapComplete) | 56 ms | 59 ms | 58 ms | 78 ms | 54 ms |
| bundle executed (main:start) | 56 ms | 59 ms | 58 ms | 78 ms | 54 ms |
| config loaded | 71 ms | 73 ms | 75 ms | 91 ms | 67 ms |
| keybindings loaded | 73 ms | 73 ms | 75 ms | 91 ms | 67 ms |
| session state loaded | 73 ms | 73 ms | 75 ms | 91 ms | 67 ms |
| extensions scanned | 69 ms | 71 ms | 71 ms | 89 ms | 65 ms |
| themes ready | 76 ms | 77 ms | 77 ms | 95 ms | 74 ms |
| DI container created | 79 ms | 81 ms | 81 ms | 99 ms | 77 ms |
| workbench mounted | 102 ms | 107 ms | 104 ms | 125 ms | 101 ms |
| first frame | 102 ms | 107 ms | 104 ms | 125 ms | 101 ms |
| workbench activated | 106 ms | 111 ms | 107 ms | 129 ms | 106 ms |
| grammars preloaded | 114 ms | 120 ms | 112 ms | 138 ms | 112 ms |
| file read from disk | 116 ms | 122 ms | 122 ms | 215 ms | 121 ms |
| file decoded | 116 ms | 122 ms | 122 ms | 215 ms | 121 ms |
| document built | 116 ms | 122 ms | 122 ms | 215 ms | 122 ms |
| tokenizer attached to editor | 133 ms | 144 ms | 158 ms | 251 ms | — |
| tabs opened | 119 ms | 127 ms | 129 ms | 223 ms | 135 ms |
| built-in extensions registered | 241 ms | 253 ms | 265 ms | 356 ms | 180 ms |
| frame with file text | 131 ms | 138 ms | 141 ms | 234 ms | 147 ms |
| frame with highlighting | 217 ms | 232 ms | 246 ms | 338 ms | — |
| extension host up | 417 ms | 462 ms | 512 ms | 889 ms | 330 ms |
| startup complete | 236 ms | 248 ms | 260 ms | 351 ms | 174 ms |
| to text (black box) | 133 ms | 140 ms | 145 ms | 235 ms | 148 ms |
| to highlight (black box) | 218 ms | 232 ms | 246 ms | 338 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 2 ms | 3 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 25 ms | 11 ms | 7 ms | 10 ms | 18 ms | 5 ms | 3 ms |
| `medium` | 25 ms | 11 ms | 8 ms | 9 ms | 16 ms | 5 ms | 3 ms |
| `large` | 34 ms | 18 ms | 22 ms | 16 ms | 37 ms | 10 ms | 15 ms |
| `xlarge` | 21 ms | 26 ms | 17 ms | 19 ms | 159 ms | 14 ms | 57 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
