# File open benchmark

- Recorded: 2026-11-02T13:44:08.640Z, commit `e187fad55cdb`, diode nightly-e187fad
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 66 ms; for reference `node --version`: 5 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **158 ms** | 118 ms | 183 ms | 304 ms | 17 ms | 256 MB | 11 |
| `medium` | 126.7 KB | 2000 | **159 ms** | 118 ms | 184 ms | 301 ms | 8 ms | 284 MB | 11 |
| `large` | 1.3 MB | 20000 | **176 ms** | 136 ms | 201 ms | 315 ms | 10 ms | 293 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **259 ms** | 218 ms | 284 ms | 391 ms | 17 ms | 365 MB | 5 |
| `log500m` | 497 MB | 5295839 | **175 ms** | 134 ms | 200 ms | — (plaintext) | 2 ms | 290 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 8 ms | 11 ms | 6 ms |
| node ready (bootstrapComplete) | 70 ms | 70 ms | 83 ms | 81 ms | 70 ms |
| bundle executed (main:start) | 70 ms | 70 ms | 83 ms | 81 ms | 70 ms |
| config loaded | 91 ms | 88 ms | 100 ms | 101 ms | 88 ms |
| keybindings loaded | 94 ms | 89 ms | 100 ms | 104 ms | 89 ms |
| session state loaded | 94 ms | 89 ms | 101 ms | 104 ms | 89 ms |
| extensions scanned | 87 ms | 85 ms | 96 ms | 97 ms | 84 ms |
| themes ready | 97 ms | 95 ms | 106 ms | 107 ms | 95 ms |
| DI container created | 101 ms | 100 ms | 111 ms | 112 ms | 99 ms |
| workbench mounted | 141 ms | 137 ms | 149 ms | 148 ms | 141 ms |
| first frame | 141 ms | 137 ms | 148 ms | 148 ms | 140 ms |
| workbench activated | 149 ms | 148 ms | 156 ms | 159 ms | 151 ms |
| grammars preloaded | 155 ms | 153 ms | 161 ms | 164 ms | 153 ms |
| file read from disk | 159 ms | 157 ms | 175 ms | 258 ms | 166 ms |
| file decoded | 159 ms | 157 ms | 175 ms | 258 ms | 166 ms |
| document built | 160 ms | 158 ms | 175 ms | 259 ms | 166 ms |
| tokenizer attached to editor | 182 ms | 183 ms | 202 ms | 285 ms | — |
| tabs opened | 165 ms | 165 ms | 187 ms | 270 ms | 186 ms |
| built-in extensions registered | 330 ms | 327 ms | 337 ms | 414 ms | 245 ms |
| frame with file text | 182 ms | 181 ms | 200 ms | 283 ms | 199 ms |
| frame with highlighting | 303 ms | 300 ms | 314 ms | 391 ms | — |
| extension host up | 592 ms | 615 ms | 688 ms | 1149 ms | 447 ms |
| startup complete | 323 ms | 320 ms | 332 ms | 408 ms | 239 ms |
| to text (black box) | 183 ms | 184 ms | 201 ms | 284 ms | 200 ms |
| to highlight (black box) | 304 ms | 301 ms | 315 ms | 391 ms | — |
| gap black − white (text) | 2 ms | 1 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 38 ms | 15 ms | 14 ms | 11 ms | 27 ms | 7 ms | 4 ms |
| `medium` | 33 ms | 14 ms | 11 ms | 10 ms | 23 ms | 7 ms | 5 ms |
| `large` | 36 ms | 28 ms | 24 ms | 19 ms | 42 ms | 17 ms | 25 ms |
| `xlarge` | 28 ms | 34 ms | 23 ms | 26 ms | 114 ms | 12 ms | 79 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
