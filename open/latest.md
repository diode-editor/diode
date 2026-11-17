# File open benchmark

- Recorded: 2026-11-17T21:35:21.479Z, commit `f6a40c0b479b`, diode nightly-f6a40c0
- Machine: AMD EPYC 9V45 96-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 20 ms; binary floor (`diode --version` over PTY, median): 52 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **114 ms** | 82 ms | 134 ms | 206 ms | 6 ms | 286 MB | 11 |
| `medium` | 126.7 KB | 2000 | **114 ms** | 82 ms | 134 ms | 206 ms | 5 ms | 295 MB | 11 |
| `large` | 1.3 MB | 20000 | **129 ms** | 97 ms | 149 ms | 221 ms | 5 ms | 309 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **200 ms** | 168 ms | 220 ms | 282 ms | 7 ms | 366 MB | 5 |
| `log500m` | 497 MB | 5295839 | **124 ms** | 92 ms | 144 ms | — (plaintext) | 2 ms | 328 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 5 ms | 6 ms | 10 ms | 5 ms |
| node ready (bootstrapComplete) | 57 ms | 56 ms | 58 ms | 78 ms | 51 ms |
| bundle executed (main:start) | 57 ms | 56 ms | 58 ms | 78 ms | 51 ms |
| config loaded | 74 ms | 72 ms | 74 ms | 102 ms | 64 ms |
| keybindings loaded | 74 ms | 72 ms | 74 ms | 102 ms | 67 ms |
| session state loaded | 74 ms | 72 ms | 74 ms | 102 ms | 67 ms |
| extensions scanned | 71 ms | 67 ms | 70 ms | 96 ms | 59 ms |
| themes ready | 77 ms | 75 ms | 78 ms | 107 ms | 69 ms |
| DI container created | 79 ms | 78 ms | 81 ms | 110 ms | 71 ms |
| workbench mounted | 106 ms | 103 ms | 109 ms | 138 ms | 99 ms |
| first frame | 106 ms | 103 ms | 109 ms | 138 ms | 99 ms |
| workbench activated | 112 ms | 109 ms | 114 ms | 143 ms | 106 ms |
| grammars preloaded | 116 ms | 114 ms | 123 ms | 147 ms | 110 ms |
| file read from disk | 118 ms | 117 ms | 130 ms | 202 ms | 117 ms |
| file decoded | 118 ms | 117 ms | 130 ms | 202 ms | 117 ms |
| document built | 118 ms | 117 ms | 130 ms | 202 ms | 117 ms |
| tokenizer attached to editor | 135 ms | 135 ms | 149 ms | 220 ms | — |
| tabs opened | 122 ms | 122 ms | 137 ms | 209 ms | 131 ms |
| built-in extensions registered | 227 ms | 227 ms | 241 ms | 301 ms | 176 ms |
| frame with file text | 133 ms | 133 ms | 147 ms | 219 ms | 142 ms |
| frame with highlighting | 206 ms | 206 ms | 221 ms | 281 ms | — |
| extension host up | 393 ms | 405 ms | 488 ms | 840 ms | 322 ms |
| startup complete | 221 ms | 220 ms | 235 ms | 295 ms | 169 ms |
| to text (black box) | 134 ms | 134 ms | 149 ms | 220 ms | 144 ms |
| to highlight (black box) | 206 ms | 206 ms | 221 ms | 282 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 2 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 11 ms | 8 ms | 6 ms | 6 ms | — | 3 ms | 2 ms |
| `medium` failed | 22 ms | 12 ms | 10 ms | 8 ms | — | 6 ms | 4 ms |
| `large` failed | 26 ms | 21 ms | 20 ms | 23 ms | — | 14 ms | 17 ms |
| `xlarge` failed | 28 ms | 20 ms | 22 ms | 19 ms | — | 12 ms | 51 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
