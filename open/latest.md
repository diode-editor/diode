# File open benchmark

- Recorded: 2026-11-01T12:03:26.258Z, commit `2e9f8713a676`, diode nightly-2e9f871
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 63 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **145 ms** | 107 ms | 170 ms | 284 ms | 10 ms | 255 MB | 11 |
| `medium` | 126.7 KB | 2000 | **146 ms** | 108 ms | 171 ms | 294 ms | 4 ms | 282 MB | 11 |
| `large` | 1.3 MB | 20000 | **166 ms** | 128 ms | 191 ms | 318 ms | 11 ms | 298 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **259 ms** | 220 ms | 283 ms | 415 ms | 6 ms | 366 MB | 5 |
| `log500m` | 497 MB | 5295839 | **167 ms** | 129 ms | 192 ms | — (plaintext) | 7 ms | 271 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 7 ms | 10 ms | 6 ms |
| node ready (bootstrapComplete) | 67 ms | 68 ms | 70 ms | 86 ms | 64 ms |
| bundle executed (main:start) | 67 ms | 68 ms | 70 ms | 86 ms | 64 ms |
| config loaded | 86 ms | 88 ms | 89 ms | 103 ms | 83 ms |
| keybindings loaded | 87 ms | 90 ms | 90 ms | 103 ms | 84 ms |
| session state loaded | 87 ms | 90 ms | 90 ms | 103 ms | 84 ms |
| extensions scanned | 81 ms | 85 ms | 85 ms | 98 ms | 79 ms |
| themes ready | 91 ms | 94 ms | 95 ms | 107 ms | 89 ms |
| DI container created | 96 ms | 98 ms | 100 ms | 112 ms | 93 ms |
| workbench mounted | 130 ms | 128 ms | 130 ms | 147 ms | 128 ms |
| first frame | 130 ms | 128 ms | 130 ms | 147 ms | 128 ms |
| workbench activated | 137 ms | 136 ms | 141 ms | 157 ms | 134 ms |
| grammars preloaded | 146 ms | 142 ms | 146 ms | 163 ms | 140 ms |
| file read from disk | 149 ms | 146 ms | 164 ms | 258 ms | 153 ms |
| file decoded | 149 ms | 146 ms | 164 ms | 258 ms | 153 ms |
| document built | 149 ms | 146 ms | 164 ms | 259 ms | 154 ms |
| tokenizer attached to editor | 171 ms | 176 ms | 207 ms | 300 ms | — |
| tabs opened | 153 ms | 153 ms | 174 ms | 269 ms | 176 ms |
| built-in extensions registered | 310 ms | 319 ms | 341 ms | 438 ms | 237 ms |
| frame with file text | 167 ms | 169 ms | 190 ms | 283 ms | 191 ms |
| frame with highlighting | 284 ms | 293 ms | 318 ms | 415 ms | — |
| extension host up | 551 ms | 586 ms | 652 ms | 1099 ms | 411 ms |
| startup complete | 304 ms | 312 ms | 335 ms | 432 ms | 229 ms |
| to text (black box) | 170 ms | 171 ms | 191 ms | 283 ms | 192 ms |
| to highlight (black box) | 284 ms | 294 ms | 318 ms | 415 ms | — |
| gap black − white (text) | 2 ms | 1 ms | 2 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 28 ms | 12 ms | 10 ms | 12 ms | 19 ms | 8 ms | 3 ms |
| `medium` | 35 ms | 12 ms | 10 ms | 11 ms | 19 ms | 7 ms | 5 ms |
| `large` | 51 ms | 28 ms | 19 ms | 25 ms | 44 ms | 13 ms | 16 ms |
| `xlarge` | 35 ms | 25 ms | 14 ms | 14 ms | 105 ms | 9 ms | 90 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
