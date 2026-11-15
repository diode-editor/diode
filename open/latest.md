# File open benchmark

- Recorded: 2026-11-15T07:00:55.440Z, commit `e2c57e8a1a55`, diode nightly-e2c57e8
- Machine: INTEL(R) XEON(R) PLATINUM 8573C (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 26 ms; binary floor (`diode --version` over PTY, median): 67 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **152 ms** | 110 ms | 177 ms | 287 ms | 5 ms | 265 MB | 11 |
| `medium` | 126.7 KB | 2000 | **149 ms** | 107 ms | 174 ms | 289 ms | 7 ms | 290 MB | 11 |
| `large` | 1.3 MB | 20000 | **163 ms** | 122 ms | 189 ms | 301 ms | 7 ms | 301 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **258 ms** | 217 ms | 284 ms | 377 ms | 8 ms | 359 MB | 5 |
| `log500m` | 497 MB | 5295839 | **162 ms** | 120 ms | 188 ms | — (plaintext) | 2 ms | 313 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 7 ms | 7 ms | 5 ms |
| node ready (bootstrapComplete) | 68 ms | 69 ms | 72 ms | 79 ms | 67 ms |
| bundle executed (main:start) | 68 ms | 69 ms | 72 ms | 79 ms | 67 ms |
| config loaded | 89 ms | 87 ms | 87 ms | 98 ms | 92 ms |
| keybindings loaded | 89 ms | 89 ms | 89 ms | 101 ms | 92 ms |
| session state loaded | 89 ms | 90 ms | 89 ms | 101 ms | 92 ms |
| extensions scanned | 85 ms | 83 ms | 84 ms | 93 ms | 85 ms |
| themes ready | 94 ms | 93 ms | 93 ms | 104 ms | 96 ms |
| DI container created | 98 ms | 97 ms | 97 ms | 107 ms | 99 ms |
| workbench mounted | 137 ms | 132 ms | 134 ms | 141 ms | 131 ms |
| first frame | 137 ms | 132 ms | 134 ms | 141 ms | 131 ms |
| workbench activated | 147 ms | 144 ms | 144 ms | 149 ms | 140 ms |
| grammars preloaded | 152 ms | 150 ms | 149 ms | 154 ms | 143 ms |
| file read from disk | 155 ms | 153 ms | 164 ms | 255 ms | 152 ms |
| file decoded | 155 ms | 153 ms | 164 ms | 255 ms | 152 ms |
| document built | 155 ms | 154 ms | 164 ms | 255 ms | 152 ms |
| tokenizer attached to editor | 176 ms | 176 ms | 189 ms | 282 ms | — |
| tabs opened | 159 ms | 160 ms | 172 ms | 265 ms | 171 ms |
| built-in extensions registered | 313 ms | 313 ms | 326 ms | 400 ms | 225 ms |
| frame with file text | 176 ms | 175 ms | 187 ms | 281 ms | 187 ms |
| frame with highlighting | 286 ms | 289 ms | 301 ms | 377 ms | — |
| extension host up | 534 ms | 561 ms | 636 ms | 1068 ms | 418 ms |
| startup complete | 301 ms | 303 ms | 317 ms | 390 ms | 213 ms |
| to text (black box) | 177 ms | 174 ms | 189 ms | 284 ms | 188 ms |
| to highlight (black box) | 287 ms | 289 ms | 301 ms | 377 ms | — |
| gap black − white (text) | 2 ms | 1 ms | 2 ms | 2 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 34 ms | 12 ms | 12 ms | 13 ms | — | 8 ms | 3 ms |
| `medium` failed | 34 ms | 15 ms | 10 ms | 8 ms | — | 6 ms | 6 ms |
| `large` failed | 36 ms | 20 ms | 21 ms | 18 ms | — | 16 ms | 18 ms |
| `xlarge` failed | 40 ms | 42 ms | 21 ms | 53 ms | — | 17 ms | 86 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
