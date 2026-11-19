# File open benchmark

- Recorded: 2026-11-19T18:58:08.544Z, commit `24d50757e764`, diode nightly-24d5075
- Machine: Intel(R) Xeon(R) 6975P-C (4 cores, 15 GB), linux 7.0.0-1016-aws
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 19 ms; binary floor (`diode --version` over PTY, median): 58 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **130 ms** | 91 ms | 149 ms | 238 ms | 7 ms | 286 MB | 11 |
| `medium` | 126.7 KB | 2000 | **135 ms** | 96 ms | 154 ms | 241 ms | 9 ms | 302 MB | 11 |
| `large` | 1.3 MB | 20000 | **145 ms** | 106 ms | 163 ms | 251 ms | 3 ms | 315 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **204 ms** | 165 ms | 222 ms | 298 ms | 16 ms | 365 MB | 5 |
| `log500m` | 497 MB | 5295839 | **139 ms** | 99 ms | 157 ms | — (plaintext) | 5 ms | 351 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 5 ms | 6 ms | 6 ms | 4 ms |
| node ready (bootstrapComplete) | 60 ms | 61 ms | 61 ms | 69 ms | 57 ms |
| bundle executed (main:start) | 60 ms | 61 ms | 61 ms | 70 ms | 57 ms |
| config loaded | 75 ms | 78 ms | 76 ms | 84 ms | 75 ms |
| keybindings loaded | 78 ms | 80 ms | 76 ms | 85 ms | 78 ms |
| session state loaded | 78 ms | 80 ms | 76 ms | 85 ms | 78 ms |
| extensions scanned | 71 ms | 73 ms | 72 ms | 79 ms | 71 ms |
| themes ready | 81 ms | 83 ms | 80 ms | 88 ms | 81 ms |
| DI container created | 83 ms | 86 ms | 83 ms | 92 ms | 83 ms |
| workbench mounted | 115 ms | 117 ms | 117 ms | 124 ms | 112 ms |
| first frame | 115 ms | 117 ms | 117 ms | 124 ms | 112 ms |
| workbench activated | 122 ms | 124 ms | 124 ms | 131 ms | 119 ms |
| grammars preloaded | 131 ms | 131 ms | 133 ms | 142 ms | 123 ms |
| file read from disk | 133 ms | 134 ms | 143 ms | 202 ms | 131 ms |
| file decoded | 133 ms | 134 ms | 143 ms | 202 ms | 131 ms |
| document built | 133 ms | 135 ms | 143 ms | 203 ms | 131 ms |
| tokenizer attached to editor | 149 ms | 155 ms | 164 ms | 224 ms | — |
| tabs opened | 137 ms | 141 ms | 151 ms | 210 ms | 145 ms |
| built-in extensions registered | 262 ms | 263 ms | 273 ms | 318 ms | 193 ms |
| frame with file text | 148 ms | 153 ms | 162 ms | 222 ms | 157 ms |
| frame with highlighting | 238 ms | 241 ms | 251 ms | 298 ms | — |
| extension host up | 444 ms | 473 ms | 553 ms | 899 ms | 340 ms |
| startup complete | 251 ms | 254 ms | 263 ms | 310 ms | 183 ms |
| to text (black box) | 149 ms | 154 ms | 163 ms | 222 ms | 157 ms |
| to highlight (black box) | 238 ms | 241 ms | 251 ms | 298 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 0 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 23 ms | 9 ms | 9 ms | 9 ms | — | 5 ms | 3 ms |
| `medium` failed | 29 ms | 13 ms | 7 ms | 9 ms | — | 4 ms | 5 ms |
| `large` failed | 29 ms | 20 ms | 18 ms | 15 ms | — | 13 ms | 15 ms |
| `xlarge` failed | 29 ms | 27 ms | 12 ms | 16 ms | — | 17 ms | 67 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
