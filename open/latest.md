# File open benchmark

- Recorded: 2026-10-31T15:55:49.865Z, commit `8d290c6a6c62`, diode nightly-8d290c6
- Machine: AMD EPYC 9V45 96-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 16 ms; binary floor (`diode --version` over PTY, median): 42 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **94 ms** | 68 ms | 111 ms | 181 ms | 11 ms | 254 MB | 11 |
| `medium` | 126.7 KB | 2000 | **97 ms** | 71 ms | 113 ms | 193 ms | 7 ms | 283 MB | 11 |
| `large` | 1.3 MB | 20000 | **114 ms** | 88 ms | 130 ms | 213 ms | 6 ms | 302 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **162 ms** | 136 ms | 178 ms | 269 ms | 2 ms | 380 MB | 5 |
| `log500m` | 497 MB | 5295839 | **104 ms** | 78 ms | 120 ms | — (plaintext) | 3 ms | 307 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 5 ms | 6 ms | 8 ms | 5 ms |
| node ready (bootstrapComplete) | 47 ms | 48 ms | 52 ms | 62 ms | 47 ms |
| bundle executed (main:start) | 47 ms | 48 ms | 52 ms | 62 ms | 47 ms |
| config loaded | 60 ms | 58 ms | 63 ms | 76 ms | 61 ms |
| keybindings loaded | 60 ms | 58 ms | 63 ms | 76 ms | 62 ms |
| session state loaded | 61 ms | 59 ms | 63 ms | 76 ms | 62 ms |
| extensions scanned | 59 ms | 56 ms | 61 ms | 74 ms | 58 ms |
| themes ready | 62 ms | 62 ms | 67 ms | 80 ms | 64 ms |
| DI container created | 64 ms | 64 ms | 70 ms | 82 ms | 66 ms |
| workbench mounted | 84 ms | 85 ms | 91 ms | 103 ms | 83 ms |
| first frame | 84 ms | 85 ms | 91 ms | 103 ms | 83 ms |
| workbench activated | 88 ms | 89 ms | 94 ms | 106 ms | 86 ms |
| grammars preloaded | 93 ms | 96 ms | 102 ms | 112 ms | 92 ms |
| file read from disk | 95 ms | 98 ms | 109 ms | 158 ms | 98 ms |
| file decoded | 95 ms | 98 ms | 109 ms | 158 ms | 98 ms |
| document built | 95 ms | 98 ms | 109 ms | 158 ms | 98 ms |
| tokenizer attached to editor | 110 ms | 116 ms | 143 ms | 193 ms | — |
| tabs opened | 98 ms | 102 ms | 115 ms | 165 ms | 111 ms |
| built-in extensions registered | 199 ms | 210 ms | 231 ms | 285 ms | 150 ms |
| frame with file text | 108 ms | 111 ms | 127 ms | 177 ms | 120 ms |
| frame with highlighting | 180 ms | 192 ms | 213 ms | 269 ms | — |
| extension host up | 346 ms | 366 ms | 414 ms | 752 ms | 280 ms |
| startup complete | 195 ms | 205 ms | 227 ms | 281 ms | 144 ms |
| to text (black box) | 111 ms | 113 ms | 130 ms | 178 ms | 120 ms |
| to highlight (black box) | 181 ms | 193 ms | 213 ms | 269 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 2 ms | 2 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 11 ms | 7 ms | 6 ms | 4 ms | 8 ms | 4 ms | 2 ms |
| `medium` | 20 ms | 9 ms | 9 ms | 7 ms | 10 ms | 4 ms | 3 ms |
| `large` | 26 ms | 14 ms | 16 ms | 15 ms | 38 ms | 12 ms | 12 ms |
| `xlarge` | 31 ms | 26 ms | 14 ms | 18 ms | 174 ms | 13 ms | 41 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
