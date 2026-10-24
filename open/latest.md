# File open benchmark

- Recorded: 2026-10-24T21:04:47.467Z, commit `bd603a41698f`, diode nightly-bd603a4
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 26 ms; binary floor (`diode --version` over PTY, median): 61 ms; for reference `node --version`: 5 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **141 ms** | 106 ms | 167 ms | 286 ms | 10 ms | 246 MB | 11 |
| `medium` | 126.7 KB | 2000 | **143 ms** | 109 ms | 170 ms | 282 ms | 10 ms | 256 MB | 11 |
| `large` | 1.3 MB | 20000 | **161 ms** | 126 ms | 187 ms | 310 ms | 6 ms | 283 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **258 ms** | 223 ms | 284 ms | 388 ms | 13 ms | 352 MB | 5 |
| `log500m` | 497 MB | 5295839 | **160 ms** | 125 ms | 186 ms | — (plaintext) | 8 ms | 294 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 8 ms | 9 ms | 7 ms |
| node ready (bootstrapComplete) | 67 ms | 68 ms | 73 ms | 78 ms | 65 ms |
| bundle executed (main:start) | 67 ms | 68 ms | 73 ms | 78 ms | 65 ms |
| config loaded | 88 ms | 86 ms | 94 ms | 102 ms | 88 ms |
| keybindings loaded | 88 ms | 88 ms | 94 ms | 102 ms | 88 ms |
| session state loaded | 88 ms | 88 ms | 94 ms | 102 ms | 88 ms |
| extensions scanned | 83 ms | 83 ms | 86 ms | 98 ms | 83 ms |
| themes ready | 91 ms | 92 ms | 97 ms | 106 ms | 91 ms |
| DI container created | 97 ms | 96 ms | 101 ms | 111 ms | 95 ms |
| workbench mounted | 128 ms | 128 ms | 134 ms | 141 ms | 128 ms |
| first frame | 128 ms | 128 ms | 134 ms | 141 ms | 128 ms |
| workbench activated | 133 ms | 133 ms | 142 ms | 151 ms | 134 ms |
| grammars preloaded | 142 ms | 144 ms | 148 ms | 157 ms | 136 ms |
| file read from disk | 144 ms | 148 ms | 162 ms | 261 ms | 152 ms |
| file decoded | 144 ms | 148 ms | 162 ms | 261 ms | 152 ms |
| document built | 145 ms | 148 ms | 163 ms | 261 ms | 152 ms |
| tokenizer attached to editor | 165 ms | 172 ms | 189 ms | 286 ms | — |
| tabs opened | 148 ms | 155 ms | 172 ms | 271 ms | 173 ms |
| built-in extensions registered | 306 ms | 303 ms | 329 ms | 408 ms | 226 ms |
| frame with file text | 164 ms | 170 ms | 187 ms | 284 ms | 186 ms |
| frame with highlighting | 286 ms | 282 ms | 310 ms | 388 ms | — |
| extension host up | 541 ms | 552 ms | 640 ms | 977 ms | 414 ms |
| startup complete | 301 ms | 298 ms | 324 ms | 403 ms | 219 ms |
| to text (black box) | 167 ms | 170 ms | 187 ms | 284 ms | 186 ms |
| to highlight (black box) | 286 ms | 282 ms | 310 ms | 388 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 36 ms | 13 ms | 8 ms | 9 ms | 17 ms | 8 ms | 4 ms |
| `medium` | 32 ms | 12 ms | 10 ms | 9 ms | 17 ms | 7 ms | 8 ms |
| `large` | 34 ms | 23 ms | 23 ms | 26 ms | 51 ms | 15 ms | 14 ms |
| `xlarge` | 28 ms | 16 ms | 9 ms | 11 ms | 96 ms | 7 ms | 78 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
