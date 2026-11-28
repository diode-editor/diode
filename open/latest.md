# File open benchmark

- Recorded: 2026-11-28T16:34:57.739Z, commit `1076339598d6`, diode nightly-1076339
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1020-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 21 ms; binary floor (`diode --version` over PTY, median): 62 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **141 ms** | 100 ms | 162 ms | 258 ms | 2 ms | 299 MB | 11 |
| `medium` | 126.7 KB | 2000 | **150 ms** | 110 ms | 172 ms | 266 ms | 12 ms | 304 MB | 11 |
| `large` | 1.3 MB | 20000 | **157 ms** | 116 ms | 178 ms | 275 ms | 9 ms | 317 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **234 ms** | 194 ms | 256 ms | 336 ms | 13 ms | 370 MB | 5 |
| `log500m` | 497 MB | 5295839 | **154 ms** | 114 ms | 176 ms | — (plaintext) | 3 ms | 326 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 7 ms | 7 ms | 8 ms | 5 ms |
| node ready (bootstrapComplete) | 68 ms | 69 ms | 72 ms | 85 ms | 62 ms |
| bundle executed (main:start) | 68 ms | 70 ms | 72 ms | 85 ms | 62 ms |
| config loaded | 88 ms | 92 ms | 90 ms | 104 ms | 77 ms |
| keybindings loaded | 89 ms | 92 ms | 91 ms | 105 ms | 77 ms |
| session state loaded | 89 ms | 92 ms | 91 ms | 105 ms | 77 ms |
| extensions scanned | 82 ms | 87 ms | 84 ms | 101 ms | 72 ms |
| themes ready | 93 ms | 96 ms | 97 ms | 108 ms | 82 ms |
| DI container created | 97 ms | 99 ms | 100 ms | 111 ms | 86 ms |
| workbench mounted | 131 ms | 134 ms | 136 ms | 145 ms | 124 ms |
| first frame | 131 ms | 134 ms | 136 ms | 145 ms | 124 ms |
| workbench activated | 137 ms | 140 ms | 142 ms | 150 ms | 137 ms |
| grammars preloaded | 142 ms | 144 ms | 146 ms | 153 ms | 139 ms |
| file read from disk | 144 ms | 149 ms | 156 ms | 227 ms | 147 ms |
| file decoded | 144 ms | 149 ms | 156 ms | 227 ms | 147 ms |
| document built | 144 ms | 149 ms | 156 ms | 227 ms | 147 ms |
| tokenizer attached to editor | 162 ms | 170 ms | 177 ms | 254 ms | — |
| tabs opened | 148 ms | 154 ms | 162 ms | 235 ms | 162 ms |
| built-in extensions registered | 287 ms | 293 ms | 301 ms | 363 ms | 220 ms |
| frame with file text | 162 ms | 168 ms | 176 ms | 253 ms | 175 ms |
| frame with highlighting | 257 ms | 265 ms | 275 ms | 336 ms | — |
| extension host up | 485 ms | 551 ms | 599 ms | 966 ms | 386 ms |
| startup complete | 277 ms | 284 ms | 292 ms | 352 ms | 209 ms |
| to text (black box) | 162 ms | 172 ms | 178 ms | 256 ms | 176 ms |
| to highlight (black box) | 258 ms | 266 ms | 275 ms | 336 ms | — |
| gap black − white (text) | 2 ms | 3 ms | 2 ms | 1 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 28 ms | 13 ms | 11 ms | 8 ms | — | 5 ms | 3 ms |
| `medium` failed | 26 ms | 16 ms | 11 ms | 11 ms | — | 6 ms | 5 ms |
| `large` failed | 33 ms | 21 ms | 22 ms | 21 ms | — | 16 ms | 15 ms |
| `xlarge` failed | 26 ms | 25 ms | 14 ms | 19 ms | — | 11 ms | 68 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
