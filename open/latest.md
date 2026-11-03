# File open benchmark

- Recorded: 2026-11-03T09:45:01.403Z, commit `fe710b7d38c5`, diode nightly-fe710b7
- Machine: AMD EPYC 9V45 96-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 16 ms; binary floor (`diode --version` over PTY, median): 43 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **96 ms** | 70 ms | 112 ms | 184 ms | 7 ms | 259 MB | 11 |
| `medium` | 126.7 KB | 2000 | **100 ms** | 73 ms | 116 ms | 188 ms | 6 ms | 283 MB | 11 |
| `large` | 1.3 MB | 20000 | **108 ms** | 82 ms | 124 ms | 190 ms | 6 ms | 301 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **160 ms** | 133 ms | 176 ms | 240 ms | 14 ms | 352 MB | 5 |
| `log500m` | 497 MB | 5295839 | **97 ms** | 70 ms | 113 ms | — (plaintext) | 3 ms | 273 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 5 ms | 7 ms | 6 ms | 4 ms |
| node ready (bootstrapComplete) | 49 ms | 51 ms | 53 ms | 58 ms | 42 ms |
| bundle executed (main:start) | 49 ms | 51 ms | 53 ms | 58 ms | 42 ms |
| config loaded | 61 ms | 64 ms | 64 ms | 78 ms | 53 ms |
| keybindings loaded | 61 ms | 64 ms | 64 ms | 79 ms | 53 ms |
| session state loaded | 61 ms | 64 ms | 64 ms | 79 ms | 53 ms |
| extensions scanned | 58 ms | 62 ms | 61 ms | 74 ms | 51 ms |
| themes ready | 64 ms | 67 ms | 68 ms | 81 ms | 56 ms |
| DI container created | 67 ms | 70 ms | 71 ms | 83 ms | 58 ms |
| workbench mounted | 87 ms | 88 ms | 91 ms | 100 ms | 78 ms |
| first frame | 87 ms | 88 ms | 91 ms | 100 ms | 78 ms |
| workbench activated | 91 ms | 91 ms | 95 ms | 103 ms | 81 ms |
| grammars preloaded | 98 ms | 99 ms | 102 ms | 106 ms | 86 ms |
| file read from disk | 99 ms | 101 ms | 109 ms | 156 ms | 93 ms |
| file decoded | 99 ms | 101 ms | 109 ms | 156 ms | 93 ms |
| document built | 100 ms | 101 ms | 109 ms | 156 ms | 93 ms |
| tokenizer attached to editor | 111 ms | 116 ms | 125 ms | 176 ms | — |
| tabs opened | 102 ms | 106 ms | 114 ms | 162 ms | 104 ms |
| built-in extensions registered | 198 ms | 207 ms | 206 ms | 257 ms | 141 ms |
| frame with file text | 111 ms | 115 ms | 123 ms | 174 ms | 113 ms |
| frame with highlighting | 182 ms | 187 ms | 190 ms | 240 ms | — |
| extension host up | 347 ms | 380 ms | 404 ms | 738 ms | 259 ms |
| startup complete | 194 ms | 202 ms | 202 ms | 252 ms | 136 ms |
| to text (black box) | 112 ms | 116 ms | 124 ms | 176 ms | 113 ms |
| to highlight (black box) | 184 ms | 188 ms | 190 ms | 240 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 1 ms | 2 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 10 ms | 6 ms | 5 ms | 5 ms | — | 3 ms | 2 ms |
| `medium` failed | 21 ms | 8 ms | 8 ms | 6 ms | — | 4 ms | 3 ms |
| `large` failed | 26 ms | 21 ms | 15 ms | 13 ms | — | 12 ms | 14 ms |
| `xlarge` failed | 23 ms | 24 ms | 13 ms | 16 ms | — | 9 ms | 39 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
