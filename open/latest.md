# File open benchmark

- Recorded: 2026-10-24T09:35:34.995Z, commit `8af2ae5525ad`, diode nightly-8af2ae5
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 20 ms; binary floor (`diode --version` over PTY, median): 50 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **105 ms** | 74 ms | 125 ms | 213 ms | 3 ms | 244 MB | 11 |
| `medium` | 126.7 KB | 2000 | **108 ms** | 77 ms | 128 ms | 213 ms | 6 ms | 247 MB | 11 |
| `large` | 1.3 MB | 20000 | **120 ms** | 89 ms | 139 ms | 223 ms | 9 ms | 287 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **183 ms** | 152 ms | 203 ms | 280 ms | 5 ms | 353 MB | 5 |
| `log500m` | 497 MB | 5295839 | **117 ms** | 86 ms | 137 ms | — (plaintext) | 3 ms | 260 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 6 ms | 6 ms | 9 ms | 5 ms |
| node ready (bootstrapComplete) | 54 ms | 55 ms | 55 ms | 68 ms | 51 ms |
| bundle executed (main:start) | 54 ms | 55 ms | 55 ms | 68 ms | 51 ms |
| config loaded | 67 ms | 70 ms | 74 ms | 79 ms | 64 ms |
| keybindings loaded | 67 ms | 72 ms | 74 ms | 79 ms | 64 ms |
| session state loaded | 67 ms | 72 ms | 74 ms | 79 ms | 64 ms |
| extensions scanned | 64 ms | 68 ms | 70 ms | 77 ms | 61 ms |
| themes ready | 70 ms | 74 ms | 76 ms | 84 ms | 68 ms |
| DI container created | 74 ms | 77 ms | 79 ms | 87 ms | 71 ms |
| workbench mounted | 97 ms | 97 ms | 99 ms | 111 ms | 95 ms |
| first frame | 97 ms | 97 ms | 99 ms | 111 ms | 95 ms |
| workbench activated | 101 ms | 101 ms | 102 ms | 114 ms | 99 ms |
| grammars preloaded | 109 ms | 106 ms | 110 ms | 120 ms | 104 ms |
| file read from disk | 111 ms | 109 ms | 122 ms | 182 ms | 113 ms |
| file decoded | 111 ms | 109 ms | 122 ms | 182 ms | 113 ms |
| document built | 111 ms | 109 ms | 122 ms | 183 ms | 113 ms |
| tokenizer attached to editor | 124 ms | 127 ms | 140 ms | 203 ms | — |
| tabs opened | 113 ms | 114 ms | 129 ms | 190 ms | 127 ms |
| built-in extensions registered | 228 ms | 229 ms | 239 ms | 294 ms | 161 ms |
| frame with file text | 123 ms | 125 ms | 139 ms | 201 ms | 136 ms |
| frame with highlighting | 212 ms | 213 ms | 222 ms | 280 ms | — |
| extension host up | 396 ms | 419 ms | 473 ms | 745 ms | 296 ms |
| startup complete | 224 ms | 225 ms | 235 ms | 291 ms | 157 ms |
| to text (black box) | 125 ms | 128 ms | 139 ms | 203 ms | 137 ms |
| to highlight (black box) | 213 ms | 213 ms | 223 ms | 280 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 1 ms | 1 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 27 ms | 10 ms | 7 ms | 9 ms | 13 ms | 8 ms | 2 ms |
| `medium` | 30 ms | 8 ms | 9 ms | 7 ms | 10 ms | 5 ms | 3 ms |
| `large` | 36 ms | 20 ms | 13 ms | 17 ms | 44 ms | 9 ms | 13 ms |
| `xlarge` | 25 ms | 23 ms | 13 ms | 15 ms | 105 ms | 10 ms | 52 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
