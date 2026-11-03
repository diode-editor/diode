# File open benchmark

- Recorded: 2026-11-03T01:50:21.934Z, commit `bb76c556a9a6`, diode nightly-bb76c55
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 24 ms; binary floor (`diode --version` over PTY, median): 64 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **149 ms** | 109 ms | 173 ms | 293 ms | 12 ms | 257 MB | 11 |
| `medium` | 126.7 KB | 2000 | **148 ms** | 109 ms | 172 ms | 291 ms | 4 ms | 281 MB | 11 |
| `large` | 1.3 MB | 20000 | **179 ms** | 139 ms | 203 ms | 317 ms | 9 ms | 292 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **261 ms** | 221 ms | 285 ms | 393 ms | 15 ms | 341 MB | 5 |
| `log500m` | 497 MB | 5295839 | **167 ms** | 128 ms | 191 ms | — (plaintext) | 27 ms | 302 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 6 ms | 9 ms | 10 ms | 6 ms |
| node ready (bootstrapComplete) | 70 ms | 69 ms | 80 ms | 93 ms | 67 ms |
| bundle executed (main:start) | 70 ms | 69 ms | 80 ms | 93 ms | 67 ms |
| config loaded | 90 ms | 89 ms | 97 ms | 109 ms | 84 ms |
| keybindings loaded | 90 ms | 91 ms | 98 ms | 110 ms | 86 ms |
| session state loaded | 90 ms | 91 ms | 98 ms | 110 ms | 86 ms |
| extensions scanned | 85 ms | 85 ms | 93 ms | 105 ms | 79 ms |
| themes ready | 95 ms | 94 ms | 102 ms | 115 ms | 89 ms |
| DI container created | 100 ms | 98 ms | 107 ms | 120 ms | 93 ms |
| workbench mounted | 136 ms | 131 ms | 145 ms | 157 ms | 130 ms |
| first frame | 136 ms | 131 ms | 145 ms | 157 ms | 130 ms |
| workbench activated | 143 ms | 138 ms | 153 ms | 168 ms | 140 ms |
| grammars preloaded | 149 ms | 144 ms | 159 ms | 173 ms | 143 ms |
| file read from disk | 152 ms | 149 ms | 174 ms | 258 ms | 154 ms |
| file decoded | 152 ms | 149 ms | 174 ms | 258 ms | 154 ms |
| document built | 152 ms | 149 ms | 174 ms | 258 ms | 154 ms |
| tokenizer attached to editor | 173 ms | 173 ms | 203 ms | 287 ms | — |
| tabs opened | 157 ms | 156 ms | 186 ms | 271 ms | 176 ms |
| built-in extensions registered | 317 ms | 315 ms | 341 ms | 417 ms | 232 ms |
| frame with file text | 172 ms | 171 ms | 201 ms | 285 ms | 189 ms |
| frame with highlighting | 293 ms | 291 ms | 317 ms | 393 ms | — |
| extension host up | 560 ms | 608 ms | 680 ms | 1123 ms | 434 ms |
| startup complete | 311 ms | 309 ms | 335 ms | 411 ms | 225 ms |
| to text (black box) | 173 ms | 172 ms | 203 ms | 285 ms | 191 ms |
| to highlight (black box) | 293 ms | 291 ms | 317 ms | 393 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 2 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 34 ms | 15 ms | 11 ms | 10 ms | — | 10 ms | 4 ms |
| `medium` failed | 32 ms | 15 ms | 13 ms | 13 ms | — | 9 ms | 5 ms |
| `large` failed | 44 ms | 27 ms | 20 ms | 18 ms | — | 15 ms | 19 ms |
| `xlarge` failed | 30 ms | 34 ms | 21 ms | 24 ms | — | 16 ms | 75 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
