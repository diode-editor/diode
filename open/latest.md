# File open benchmark

- Recorded: 2026-11-04T13:08:19.578Z, commit `cb452e6e8985`, diode nightly-cb452e6
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 21 ms; binary floor (`diode --version` over PTY, median): 56 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **120 ms** | 85 ms | 141 ms | 232 ms | 5 ms | 258 MB | 11 |
| `medium` | 126.7 KB | 2000 | **130 ms** | 95 ms | 151 ms | 237 ms | 21 ms | 282 MB | 11 |
| `large` | 1.3 MB | 20000 | **135 ms** | 99 ms | 155 ms | 242 ms | 4 ms | 291 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **206 ms** | 170 ms | 226 ms | 301 ms | 2 ms | 348 MB | 5 |
| `log500m` | 497 MB | 5295839 | **130 ms** | 95 ms | 151 ms | — (plaintext) | 4 ms | 274 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 7 ms | 8 ms | 5 ms |
| node ready (bootstrapComplete) | 59 ms | 61 ms | 63 ms | 78 ms | 56 ms |
| bundle executed (main:start) | 59 ms | 61 ms | 63 ms | 78 ms | 56 ms |
| config loaded | 75 ms | 77 ms | 78 ms | 95 ms | 72 ms |
| keybindings loaded | 75 ms | 79 ms | 78 ms | 95 ms | 72 ms |
| session state loaded | 75 ms | 79 ms | 78 ms | 95 ms | 72 ms |
| extensions scanned | 71 ms | 74 ms | 75 ms | 92 ms | 69 ms |
| themes ready | 78 ms | 84 ms | 83 ms | 99 ms | 76 ms |
| DI container created | 81 ms | 87 ms | 86 ms | 102 ms | 80 ms |
| workbench mounted | 109 ms | 114 ms | 113 ms | 131 ms | 108 ms |
| first frame | 109 ms | 114 ms | 113 ms | 131 ms | 108 ms |
| workbench activated | 113 ms | 119 ms | 117 ms | 135 ms | 112 ms |
| grammars preloaded | 121 ms | 128 ms | 126 ms | 144 ms | 118 ms |
| file read from disk | 123 ms | 131 ms | 135 ms | 205 ms | 127 ms |
| file decoded | 123 ms | 131 ms | 135 ms | 205 ms | 127 ms |
| document built | 123 ms | 131 ms | 135 ms | 205 ms | 127 ms |
| tokenizer attached to editor | 140 ms | 150 ms | 155 ms | 227 ms | — |
| tabs opened | 127 ms | 137 ms | 143 ms | 213 ms | 141 ms |
| built-in extensions registered | 254 ms | 259 ms | 263 ms | 322 ms | 188 ms |
| frame with file text | 139 ms | 149 ms | 154 ms | 225 ms | 151 ms |
| frame with highlighting | 232 ms | 237 ms | 242 ms | 301 ms | — |
| extension host up | 455 ms | 503 ms | 554 ms | 928 ms | 346 ms |
| startup complete | 247 ms | 251 ms | 256 ms | 315 ms | 180 ms |
| to text (black box) | 141 ms | 151 ms | 155 ms | 226 ms | 151 ms |
| to highlight (black box) | 232 ms | 237 ms | 242 ms | 301 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 1 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 26 ms | 12 ms | 9 ms | 12 ms | — | 5 ms | 3 ms |
| `medium` failed | 27 ms | 12 ms | 12 ms | 13 ms | — | 4 ms | 5 ms |
| `large` failed | 38 ms | 23 ms | 20 ms | 16 ms | — | 14 ms | 14 ms |
| `xlarge` failed | 33 ms | 35 ms | 22 ms | 36 ms | — | 18 ms | 68 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
