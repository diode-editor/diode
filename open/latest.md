# File open benchmark

- Recorded: 2026-10-24T19:51:17.358Z, commit `23d864ac0927`, diode nightly-23d864a
- Machine: AMD EPYC 9V45 96-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 18 ms; binary floor (`diode --version` over PTY, median): 39 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **80 ms** | 59 ms | 98 ms | 166 ms | 5 ms | 245 MB | 11 |
| `medium` | 126.7 KB | 2000 | **87 ms** | 66 ms | 105 ms | 177 ms | 5 ms | 269 MB | 11 |
| `large` | 1.3 MB | 20000 | **93 ms** | 72 ms | 111 ms | 183 ms | 5 ms | 292 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **147 ms** | 126 ms | 164 ms | 232 ms | 4 ms | 356 MB | 5 |
| `log500m` | 497 MB | 5295839 | **93 ms** | 71 ms | 110 ms | — (plaintext) | 3 ms | 261 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 5 ms | 5 ms | 7 ms | 5 ms |
| node ready (bootstrapComplete) | 42 ms | 46 ms | 47 ms | 58 ms | 42 ms |
| bundle executed (main:start) | 42 ms | 46 ms | 47 ms | 58 ms | 42 ms |
| config loaded | 54 ms | 57 ms | 57 ms | 75 ms | 51 ms |
| keybindings loaded | 54 ms | 57 ms | 58 ms | 75 ms | 53 ms |
| session state loaded | 54 ms | 57 ms | 58 ms | 75 ms | 53 ms |
| extensions scanned | 52 ms | 55 ms | 56 ms | 70 ms | 50 ms |
| themes ready | 57 ms | 60 ms | 60 ms | 77 ms | 56 ms |
| DI container created | 59 ms | 64 ms | 62 ms | 79 ms | 61 ms |
| workbench mounted | 75 ms | 80 ms | 79 ms | 93 ms | 79 ms |
| first frame | 75 ms | 80 ms | 79 ms | 93 ms | 79 ms |
| workbench activated | 78 ms | 83 ms | 82 ms | 96 ms | 82 ms |
| grammars preloaded | 84 ms | 88 ms | 89 ms | 102 ms | 86 ms |
| file read from disk | 86 ms | 90 ms | 96 ms | 147 ms | 92 ms |
| file decoded | 86 ms | 90 ms | 96 ms | 147 ms | 92 ms |
| document built | 86 ms | 91 ms | 96 ms | 147 ms | 93 ms |
| tokenizer attached to editor | 96 ms | 105 ms | 110 ms | 164 ms | — |
| tabs opened | 88 ms | 94 ms | 101 ms | 153 ms | 103 ms |
| built-in extensions registered | 179 ms | 190 ms | 195 ms | 244 ms | 132 ms |
| frame with file text | 96 ms | 103 ms | 109 ms | 162 ms | 110 ms |
| frame with highlighting | 165 ms | 177 ms | 183 ms | 232 ms | — |
| extension host up | 310 ms | 337 ms | 363 ms | 627 ms | 240 ms |
| startup complete | 176 ms | 187 ms | 192 ms | 242 ms | 129 ms |
| to text (black box) | 98 ms | 105 ms | 111 ms | 164 ms | 110 ms |
| to highlight (black box) | 166 ms | 177 ms | 183 ms | 232 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 2 ms | 2 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 10 ms | 4 ms | 6 ms | 3 ms | 6 ms | 3 ms | 2 ms |
| `medium` | 15 ms | 12 ms | 6 ms | 7 ms | 8 ms | 3 ms | 2 ms |
| `large` | 27 ms | 16 ms | 11 ms | 14 ms | 43 ms | 8 ms | 9 ms |
| `xlarge` | 20 ms | 17 ms | 12 ms | 9 ms | 102 ms | 8 ms | 42 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
