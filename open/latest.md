# File open benchmark

- Recorded: 2026-11-16T18:07:24.613Z, commit `e8bfffd774ee`, diode nightly-e8bfffd
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 24 ms; binary floor (`diode --version` over PTY, median): 70 ms; for reference `node --version`: 5 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **176 ms** | 130 ms | 200 ms | 316 ms | 18 ms | 284 MB | 11 |
| `medium` | 126.7 KB | 2000 | **172 ms** | 127 ms | 197 ms | 311 ms | 7 ms | 291 MB | 11 |
| `large` | 1.3 MB | 20000 | **187 ms** | 142 ms | 211 ms | 331 ms | 4 ms | 301 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **275 ms** | 230 ms | 299 ms | 397 ms | 15 ms | 357 MB | 5 |
| `log500m` | 497 MB | 5295839 | **182 ms** | 137 ms | 206 ms | — (plaintext) | 4 ms | 312 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 8 ms | 7 ms | 8 ms | 8 ms | 6 ms |
| node ready (bootstrapComplete) | 77 ms | 79 ms | 79 ms | 90 ms | 71 ms |
| bundle executed (main:start) | 77 ms | 79 ms | 79 ms | 90 ms | 71 ms |
| config loaded | 100 ms | 98 ms | 107 ms | 110 ms | 90 ms |
| keybindings loaded | 101 ms | 100 ms | 108 ms | 111 ms | 91 ms |
| session state loaded | 101 ms | 100 ms | 108 ms | 111 ms | 91 ms |
| extensions scanned | 94 ms | 93 ms | 101 ms | 106 ms | 86 ms |
| themes ready | 108 ms | 104 ms | 111 ms | 117 ms | 99 ms |
| DI container created | 111 ms | 108 ms | 115 ms | 121 ms | 104 ms |
| workbench mounted | 156 ms | 155 ms | 158 ms | 169 ms | 150 ms |
| first frame | 156 ms | 155 ms | 158 ms | 169 ms | 150 ms |
| workbench activated | 164 ms | 161 ms | 165 ms | 177 ms | 157 ms |
| grammars preloaded | 168 ms | 167 ms | 170 ms | 182 ms | 160 ms |
| file read from disk | 171 ms | 172 ms | 182 ms | 269 ms | 172 ms |
| file decoded | 171 ms | 172 ms | 182 ms | 269 ms | 172 ms |
| document built | 171 ms | 172 ms | 182 ms | 270 ms | 172 ms |
| tokenizer attached to editor | 197 ms | 197 ms | 212 ms | 298 ms | — |
| tabs opened | 176 ms | 179 ms | 192 ms | 279 ms | 192 ms |
| built-in extensions registered | 346 ms | 341 ms | 361 ms | 424 ms | 255 ms |
| frame with file text | 196 ms | 195 ms | 209 ms | 296 ms | 206 ms |
| frame with highlighting | 315 ms | 310 ms | 331 ms | 397 ms | — |
| extension host up | 604 ms | 641 ms | 708 ms | 1140 ms | 471 ms |
| startup complete | 335 ms | 331 ms | 350 ms | 415 ms | 246 ms |
| to text (black box) | 200 ms | 197 ms | 211 ms | 299 ms | 206 ms |
| to highlight (black box) | 316 ms | 311 ms | 331 ms | 397 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 2 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 38 ms | 21 ms | 12 ms | 10 ms | — | 8 ms | 6 ms |
| `medium` failed | 32 ms | 13 ms | 13 ms | 12 ms | — | 8 ms | 5 ms |
| `large` failed | 37 ms | 29 ms | 22 ms | 31 ms | — | 14 ms | 17 ms |
| `xlarge` failed | 31 ms | 42 ms | 30 ms | 27 ms | — | 17 ms | 90 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
