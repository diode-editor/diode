# File open benchmark

- Recorded: 2026-11-01T17:50:32.160Z, commit `f173b1ba4571`, diode nightly-f173b1b
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 24 ms; binary floor (`diode --version` over PTY, median): 62 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **149 ms** | 110 ms | 173 ms | 291 ms | 10 ms | 270 MB | 11 |
| `medium` | 126.7 KB | 2000 | **152 ms** | 114 ms | 176 ms | 301 ms | 6 ms | 281 MB | 11 |
| `large` | 1.3 MB | 20000 | **170 ms** | 132 ms | 194 ms | 329 ms | 8 ms | 293 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **257 ms** | 219 ms | 281 ms | 411 ms | 22 ms | 362 MB | 5 |
| `log500m` | 497 MB | 5295839 | **161 ms** | 123 ms | 185 ms | — (plaintext) | 1 ms | 306 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 6 ms | 7 ms | 9 ms | 6 ms |
| node ready (bootstrapComplete) | 70 ms | 69 ms | 71 ms | 84 ms | 66 ms |
| bundle executed (main:start) | 70 ms | 69 ms | 71 ms | 84 ms | 66 ms |
| config loaded | 90 ms | 89 ms | 90 ms | 103 ms | 89 ms |
| keybindings loaded | 91 ms | 91 ms | 91 ms | 103 ms | 89 ms |
| session state loaded | 91 ms | 91 ms | 92 ms | 103 ms | 89 ms |
| extensions scanned | 86 ms | 85 ms | 87 ms | 99 ms | 85 ms |
| themes ready | 94 ms | 94 ms | 97 ms | 108 ms | 94 ms |
| DI container created | 98 ms | 98 ms | 101 ms | 113 ms | 97 ms |
| workbench mounted | 135 ms | 134 ms | 136 ms | 146 ms | 129 ms |
| first frame | 135 ms | 134 ms | 136 ms | 146 ms | 129 ms |
| workbench activated | 142 ms | 144 ms | 144 ms | 151 ms | 135 ms |
| grammars preloaded | 147 ms | 149 ms | 150 ms | 157 ms | 138 ms |
| file read from disk | 149 ms | 152 ms | 166 ms | 253 ms | 150 ms |
| file decoded | 150 ms | 152 ms | 166 ms | 253 ms | 150 ms |
| document built | 150 ms | 152 ms | 166 ms | 254 ms | 150 ms |
| tokenizer attached to editor | 173 ms | 185 ms | 208 ms | 297 ms | — |
| tabs opened | 154 ms | 160 ms | 177 ms | 266 ms | 171 ms |
| built-in extensions registered | 317 ms | 327 ms | 353 ms | 434 ms | 232 ms |
| frame with file text | 171 ms | 176 ms | 191 ms | 280 ms | 185 ms |
| frame with highlighting | 291 ms | 301 ms | 329 ms | 411 ms | — |
| extension host up | 567 ms | 611 ms | 673 ms | 1112 ms | 427 ms |
| startup complete | 311 ms | 321 ms | 347 ms | 429 ms | 223 ms |
| to text (black box) | 173 ms | 176 ms | 194 ms | 281 ms | 185 ms |
| to highlight (black box) | 291 ms | 301 ms | 329 ms | 411 ms | — |
| gap black − white (text) | 2 ms | 1 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 32 ms | 13 ms | 11 ms | 12 ms | 25 ms | 7 ms | 4 ms |
| `medium` | 32 ms | 15 ms | 12 ms | 10 ms | 23 ms | 5 ms | 5 ms |
| `large` | 44 ms | 27 ms | 29 ms | 20 ms | 45 ms | 16 ms | 19 ms |
| `xlarge` | 29 ms | 33 ms | 21 ms | 25 ms | 134 ms | 16 ms | 73 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
