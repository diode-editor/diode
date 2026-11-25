# File open benchmark

- Recorded: 2026-11-25T08:10:24.384Z, commit `99565b0c61c1`, diode nightly-99565b0
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1020-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 26 ms; binary floor (`diode --version` over PTY, median): 78 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **175 ms** | 123 ms | 201 ms | 313 ms | 11 ms | 295 MB | 11 |
| `medium` | 126.7 KB | 2000 | **180 ms** | 128 ms | 206 ms | 314 ms | 9 ms | 302 MB | 11 |
| `large` | 1.3 MB | 20000 | **185 ms** | 133 ms | 211 ms | 331 ms | 20 ms | 315 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **271 ms** | 218 ms | 296 ms | 403 ms | 12 ms | 364 MB | 5 |
| `log500m` | 497 MB | 5295839 | **182 ms** | 130 ms | 208 ms | — (plaintext) | 4 ms | 328 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 8 ms | 9 ms | 6 ms |
| node ready (bootstrapComplete) | 82 ms | 81 ms | 87 ms | 95 ms | 76 ms |
| bundle executed (main:start) | 83 ms | 81 ms | 87 ms | 95 ms | 76 ms |
| config loaded | 105 ms | 104 ms | 109 ms | 114 ms | 97 ms |
| keybindings loaded | 106 ms | 104 ms | 110 ms | 114 ms | 101 ms |
| session state loaded | 106 ms | 104 ms | 110 ms | 114 ms | 101 ms |
| extensions scanned | 99 ms | 96 ms | 103 ms | 108 ms | 92 ms |
| themes ready | 111 ms | 109 ms | 115 ms | 121 ms | 105 ms |
| DI container created | 115 ms | 113 ms | 119 ms | 126 ms | 109 ms |
| workbench mounted | 164 ms | 162 ms | 162 ms | 177 ms | 152 ms |
| first frame | 164 ms | 162 ms | 162 ms | 177 ms | 152 ms |
| workbench activated | 172 ms | 168 ms | 169 ms | 185 ms | 159 ms |
| grammars preloaded | 177 ms | 173 ms | 175 ms | 190 ms | 162 ms |
| file read from disk | 180 ms | 178 ms | 186 ms | 269 ms | 172 ms |
| file decoded | 180 ms | 178 ms | 186 ms | 269 ms | 172 ms |
| document built | 180 ms | 178 ms | 187 ms | 269 ms | 172 ms |
| tokenizer attached to editor | 200 ms | 203 ms | 211 ms | 298 ms | — |
| tabs opened | 185 ms | 184 ms | 195 ms | 280 ms | 192 ms |
| built-in extensions registered | 346 ms | 347 ms | 363 ms | 434 ms | 258 ms |
| frame with file text | 199 ms | 201 ms | 209 ms | 296 ms | 207 ms |
| frame with highlighting | 312 ms | 314 ms | 331 ms | 403 ms | — |
| extension host up | 596 ms | 639 ms | 703 ms | 1121 ms | 457 ms |
| startup complete | 335 ms | 336 ms | 352 ms | 423 ms | 245 ms |
| to text (black box) | 201 ms | 206 ms | 211 ms | 296 ms | 208 ms |
| to highlight (black box) | 313 ms | 314 ms | 331 ms | 403 ms | — |
| gap black − white (text) | 1 ms | 3 ms | 2 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 36 ms | 13 ms | 10 ms | 11 ms | — | 9 ms | 3 ms |
| `medium` failed | 34 ms | 15 ms | 12 ms | 11 ms | — | 8 ms | 6 ms |
| `large` failed | 32 ms | 30 ms | 30 ms | 24 ms | — | 17 ms | 19 ms |
| `xlarge` failed | 31 ms | 36 ms | 24 ms | 28 ms | — | 18 ms | 88 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
