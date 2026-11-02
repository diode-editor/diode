# File open benchmark

- Recorded: 2026-11-02T09:30:24.245Z, commit `900de39474ea`, diode nightly-900de39
- Machine: AMD EPYC 9V45 96-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 18 ms; binary floor (`diode --version` over PTY, median): 44 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **104 ms** | 78 ms | 122 ms | 198 ms | 8 ms | 265 MB | 11 |
| `medium` | 126.7 KB | 2000 | **99 ms** | 73 ms | 117 ms | 190 ms | 6 ms | 283 MB | 11 |
| `large` | 1.3 MB | 20000 | **107 ms** | 81 ms | 125 ms | 209 ms | 4 ms | 300 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **169 ms** | 143 ms | 187 ms | 279 ms | 8 ms | 380 MB | 5 |
| `log500m` | 497 MB | 5295839 | **98 ms** | 72 ms | 115 ms | — (plaintext) | 7 ms | 306 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 6 ms | 6 ms | 11 ms | 5 ms |
| node ready (bootstrapComplete) | 50 ms | 49 ms | 52 ms | 67 ms | 46 ms |
| bundle executed (main:start) | 50 ms | 49 ms | 52 ms | 67 ms | 46 ms |
| config loaded | 64 ms | 62 ms | 63 ms | 88 ms | 58 ms |
| keybindings loaded | 64 ms | 62 ms | 63 ms | 89 ms | 59 ms |
| session state loaded | 64 ms | 62 ms | 64 ms | 89 ms | 59 ms |
| extensions scanned | 61 ms | 58 ms | 61 ms | 84 ms | 56 ms |
| themes ready | 67 ms | 65 ms | 67 ms | 91 ms | 61 ms |
| DI container created | 70 ms | 67 ms | 70 ms | 93 ms | 64 ms |
| workbench mounted | 93 ms | 88 ms | 92 ms | 110 ms | 83 ms |
| first frame | 93 ms | 88 ms | 92 ms | 110 ms | 83 ms |
| workbench activated | 96 ms | 91 ms | 95 ms | 113 ms | 86 ms |
| grammars preloaded | 104 ms | 98 ms | 101 ms | 117 ms | 87 ms |
| file read from disk | 106 ms | 100 ms | 109 ms | 168 ms | 95 ms |
| file decoded | 106 ms | 100 ms | 109 ms | 168 ms | 95 ms |
| document built | 106 ms | 100 ms | 110 ms | 169 ms | 95 ms |
| tokenizer attached to editor | 120 ms | 120 ms | 139 ms | 204 ms | — |
| tabs opened | 109 ms | 105 ms | 115 ms | 175 ms | 107 ms |
| built-in extensions registered | 216 ms | 208 ms | 225 ms | 294 ms | 139 ms |
| frame with file text | 119 ms | 114 ms | 124 ms | 186 ms | 115 ms |
| frame with highlighting | 198 ms | 190 ms | 208 ms | 278 ms | — |
| extension host up | 372 ms | 394 ms | 433 ms | 753 ms | 260 ms |
| startup complete | 212 ms | 205 ms | 221 ms | 290 ms | 135 ms |
| to text (black box) | 122 ms | 117 ms | 125 ms | 187 ms | 115 ms |
| to highlight (black box) | 198 ms | 190 ms | 209 ms | 279 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 1 ms | 3 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 11 ms | 6 ms | 6 ms | 5 ms | 9 ms | 4 ms | 2 ms |
| `medium` | 20 ms | 11 ms | 6 ms | 6 ms | 11 ms | 4 ms | 4 ms |
| `large` | 19 ms | 20 ms | 15 ms | 11 ms | 43 ms | 10 ms | 15 ms |
| `xlarge` | 26 ms | 23 ms | 14 ms | 16 ms | 149 ms | 12 ms | 42 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
