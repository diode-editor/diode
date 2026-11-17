# File open benchmark

- Recorded: 2026-11-17T20:38:45.720Z, commit `cd9a2930bdad`, diode nightly-cd9a293
- Machine: AMD EPYC 9V45 96-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 16 ms; binary floor (`diode --version` over PTY, median): 46 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **102 ms** | 72 ms | 118 ms | 185 ms | 7 ms | 288 MB | 11 |
| `medium` | 126.7 KB | 2000 | **103 ms** | 73 ms | 119 ms | 187 ms | 5 ms | 295 MB | 11 |
| `large` | 1.3 MB | 20000 | **115 ms** | 85 ms | 131 ms | 198 ms | 7 ms | 313 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **261 ms** | 231 ms | 277 ms | 335 ms | 91 ms ⚠ noisy | 368 MB | 5 |
| `log500m` | 497 MB | 5295839 | **108 ms** | 78 ms | 124 ms | — (plaintext) | 5 ms | 339 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 5 ms | 5 ms | 8 ms | 5 ms |
| node ready (bootstrapComplete) | 50 ms | 51 ms | 53 ms | 71 ms | 47 ms |
| bundle executed (main:start) | 50 ms | 51 ms | 53 ms | 71 ms | 47 ms |
| config loaded | 66 ms | 66 ms | 67 ms | 95 ms | 61 ms |
| keybindings loaded | 66 ms | 67 ms | 68 ms | 95 ms | 61 ms |
| session state loaded | 66 ms | 67 ms | 68 ms | 95 ms | 61 ms |
| extensions scanned | 62 ms | 60 ms | 63 ms | 88 ms | 57 ms |
| themes ready | 68 ms | 69 ms | 70 ms | 97 ms | 64 ms |
| DI container created | 70 ms | 71 ms | 72 ms | 100 ms | 66 ms |
| workbench mounted | 93 ms | 92 ms | 94 ms | 163 ms | 89 ms |
| first frame | 93 ms | 92 ms | 94 ms | 163 ms | 89 ms |
| workbench activated | 98 ms | 97 ms | 99 ms | 171 ms | 92 ms |
| grammars preloaded | 101 ms | 100 ms | 102 ms | 175 ms | 94 ms |
| file read from disk | 102 ms | 103 ms | 109 ms | 255 ms | 102 ms |
| file decoded | 102 ms | 103 ms | 109 ms | 255 ms | 102 ms |
| document built | 102 ms | 103 ms | 109 ms | 255 ms | 102 ms |
| tokenizer attached to editor | 118 ms | 119 ms | 132 ms | 276 ms | — |
| tabs opened | 105 ms | 107 ms | 116 ms | 263 ms | 114 ms |
| built-in extensions registered | 204 ms | 208 ms | 218 ms | 354 ms | 152 ms |
| frame with file text | 117 ms | 117 ms | 131 ms | 274 ms | 124 ms |
| frame with highlighting | 184 ms | 187 ms | 198 ms | 335 ms | — |
| extension host up | 351 ms | 375 ms | 445 ms | 833 ms | 268 ms |
| startup complete | 197 ms | 201 ms | 212 ms | 348 ms | 145 ms |
| to text (black box) | 118 ms | 119 ms | 131 ms | 277 ms | 124 ms |
| to highlight (black box) | 185 ms | 187 ms | 198 ms | 335 ms | — |
| gap black − white (text) | 2 ms | 1 ms | 1 ms | 3 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 9 ms | 5 ms | 5 ms | 3 ms | — | 4 ms | 2 ms |
| `medium` failed | 15 ms | 9 ms | 6 ms | 5 ms | — | 3 ms | 3 ms |
| `large` failed | 21 ms | 18 ms | 13 ms | 17 ms | — | 17 ms | 13 ms |
| `xlarge` failed | 30 ms | 27 ms | 17 ms | 22 ms | — | 14 ms | 42 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
