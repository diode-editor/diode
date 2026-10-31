# File open benchmark

- Recorded: 2026-10-31T11:31:55.094Z, commit `d023fae76e76`, diode nightly-d023fae
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 62 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **137 ms** | 100 ms | 162 ms | 281 ms | 8 ms | 262 MB | 11 |
| `medium` | 126.7 KB | 2000 | **142 ms** | 104 ms | 167 ms | 288 ms | 5 ms | 279 MB | 11 |
| `large` | 1.3 MB | 20000 | **159 ms** | 122 ms | 184 ms | 318 ms | 14 ms | 296 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **242 ms** | 205 ms | 267 ms | 394 ms | 2 ms | 362 MB | 5 |
| `log500m` | 497 MB | 5295839 | **160 ms** | 123 ms | 185 ms | — (plaintext) | 2 ms | 269 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 7 ms | 8 ms | 6 ms |
| node ready (bootstrapComplete) | 67 ms | 65 ms | 70 ms | 77 ms | 62 ms |
| bundle executed (main:start) | 67 ms | 65 ms | 70 ms | 77 ms | 62 ms |
| config loaded | 87 ms | 85 ms | 89 ms | 98 ms | 80 ms |
| keybindings loaded | 88 ms | 86 ms | 89 ms | 98 ms | 82 ms |
| session state loaded | 88 ms | 86 ms | 89 ms | 98 ms | 82 ms |
| extensions scanned | 83 ms | 80 ms | 84 ms | 94 ms | 77 ms |
| themes ready | 90 ms | 91 ms | 92 ms | 103 ms | 87 ms |
| DI container created | 94 ms | 95 ms | 95 ms | 107 ms | 91 ms |
| workbench mounted | 130 ms | 127 ms | 130 ms | 139 ms | 126 ms |
| first frame | 130 ms | 127 ms | 130 ms | 139 ms | 126 ms |
| workbench activated | 135 ms | 132 ms | 137 ms | 147 ms | 137 ms |
| grammars preloaded | 141 ms | 137 ms | 147 ms | 155 ms | 139 ms |
| file read from disk | 143 ms | 141 ms | 158 ms | 241 ms | 150 ms |
| file decoded | 143 ms | 141 ms | 158 ms | 241 ms | 150 ms |
| document built | 144 ms | 141 ms | 159 ms | 242 ms | 150 ms |
| tokenizer attached to editor | 164 ms | 171 ms | 200 ms | 283 ms | — |
| tabs opened | 148 ms | 149 ms | 167 ms | 252 ms | 169 ms |
| built-in extensions registered | 307 ms | 315 ms | 340 ms | 417 ms | 229 ms |
| frame with file text | 162 ms | 164 ms | 183 ms | 266 ms | 185 ms |
| frame with highlighting | 280 ms | 288 ms | 317 ms | 394 ms | — |
| extension host up | 546 ms | 591 ms | 645 ms | 1080 ms | 403 ms |
| startup complete | 300 ms | 308 ms | 335 ms | 411 ms | 222 ms |
| to text (black box) | 162 ms | 167 ms | 184 ms | 267 ms | 185 ms |
| to highlight (black box) | 281 ms | 288 ms | 318 ms | 394 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 36 ms | 18 ms | 12 ms | 12 ms | 14 ms | 7 ms | 5 ms |
| `medium` | 33 ms | 11 ms | 11 ms | 11 ms | 15 ms | 8 ms | 5 ms |
| `large` | 43 ms | 27 ms | 22 ms | 17 ms | 40 ms | 14 ms | 15 ms |
| `xlarge` | 26 ms | 29 ms | 19 ms | 23 ms | 111 ms | 14 ms | 76 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
