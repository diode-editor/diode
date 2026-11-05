# File open benchmark

- Recorded: 2026-11-05T00:25:38.248Z, commit `1d3af034d4aa`, diode nightly-1d3af03
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 27 ms; binary floor (`diode --version` over PTY, median): 69 ms; for reference `node --version`: 5 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **157 ms** | 114 ms | 183 ms | 302 ms | 13 ms | 277 MB | 11 |
| `medium` | 126.7 KB | 2000 | **166 ms** | 124 ms | 193 ms | 315 ms | 11 ms | 281 MB | 11 |
| `large` | 1.3 MB | 20000 | **188 ms** | 145 ms | 215 ms | 339 ms | 2 ms | 295 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **276 ms** | 233 ms | 303 ms | 406 ms | 12 ms | 344 MB | 5 |
| `log500m` | 497 MB | 5295839 | **171 ms** | 128 ms | 198 ms | — (plaintext) | 7 ms | 308 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 9 ms | 8 ms | 9 ms | 13 ms | 6 ms |
| node ready (bootstrapComplete) | 76 ms | 78 ms | 82 ms | 99 ms | 70 ms |
| bundle executed (main:start) | 76 ms | 78 ms | 82 ms | 99 ms | 70 ms |
| config loaded | 99 ms | 101 ms | 102 ms | 119 ms | 92 ms |
| keybindings loaded | 100 ms | 102 ms | 103 ms | 120 ms | 92 ms |
| session state loaded | 101 ms | 102 ms | 103 ms | 120 ms | 92 ms |
| extensions scanned | 94 ms | 96 ms | 98 ms | 115 ms | 86 ms |
| themes ready | 105 ms | 106 ms | 108 ms | 126 ms | 98 ms |
| DI container created | 109 ms | 110 ms | 114 ms | 131 ms | 103 ms |
| workbench mounted | 143 ms | 150 ms | 160 ms | 172 ms | 138 ms |
| first frame | 143 ms | 150 ms | 160 ms | 172 ms | 138 ms |
| workbench activated | 149 ms | 156 ms | 166 ms | 178 ms | 143 ms |
| grammars preloaded | 155 ms | 162 ms | 172 ms | 186 ms | 146 ms |
| file read from disk | 158 ms | 167 ms | 187 ms | 276 ms | 163 ms |
| file decoded | 158 ms | 167 ms | 187 ms | 276 ms | 163 ms |
| document built | 158 ms | 167 ms | 187 ms | 276 ms | 163 ms |
| tokenizer attached to editor | 180 ms | 193 ms | 215 ms | 304 ms | — |
| tabs opened | 164 ms | 174 ms | 197 ms | 287 ms | 183 ms |
| built-in extensions registered | 330 ms | 344 ms | 368 ms | 434 ms | 250 ms |
| frame with file text | 179 ms | 191 ms | 213 ms | 303 ms | 198 ms |
| frame with highlighting | 302 ms | 315 ms | 339 ms | 406 ms | — |
| extension host up | 607 ms | 668 ms | 736 ms | 1179 ms | 486 ms |
| startup complete | 321 ms | 334 ms | 359 ms | 424 ms | 238 ms |
| to text (black box) | 183 ms | 193 ms | 215 ms | 303 ms | 198 ms |
| to highlight (black box) | 302 ms | 315 ms | 339 ms | 406 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 34 ms | 16 ms | 14 ms | 13 ms | — | 9 ms | 5 ms |
| `medium` failed | 37 ms | 17 ms | 12 ms | 14 ms | — | 8 ms | 8 ms |
| `large` failed | 41 ms | 23 ms | 21 ms | 23 ms | — | 24 ms | 19 ms |
| `xlarge` failed | 28 ms | 50 ms | 22 ms | 44 ms | — | 31 ms | 93 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
