# File open benchmark

- Recorded: 2026-10-25T10:42:50.868Z, commit `5472f0095fd4`, diode nightly-5472f00
- Machine: AMD EPYC 9V45 96-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 16 ms; binary floor (`diode --version` over PTY, median): 39 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **81 ms** | 58 ms | 97 ms | 164 ms | 4 ms | 243 MB | 11 |
| `medium` | 126.7 KB | 2000 | **83 ms** | 61 ms | 99 ms | 168 ms | 2 ms | 261 MB | 11 |
| `large` | 1.3 MB | 20000 | **93 ms** | 71 ms | 109 ms | 177 ms | 4 ms | 287 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **148 ms** | 125 ms | 164 ms | 224 ms | 2 ms | 356 MB | 5 |
| `log500m` | 497 MB | 5295839 | **87 ms** | 65 ms | 104 ms | — (plaintext) | 1 ms | 311 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 5 ms | 5 ms | 7 ms | 5 ms |
| node ready (bootstrapComplete) | 43 ms | 43 ms | 47 ms | 56 ms | 40 ms |
| bundle executed (main:start) | 43 ms | 43 ms | 48 ms | 56 ms | 40 ms |
| config loaded | 53 ms | 55 ms | 62 ms | 74 ms | 55 ms |
| keybindings loaded | 54 ms | 55 ms | 63 ms | 74 ms | 55 ms |
| session state loaded | 54 ms | 55 ms | 63 ms | 74 ms | 55 ms |
| extensions scanned | 51 ms | 53 ms | 60 ms | 69 ms | 52 ms |
| themes ready | 57 ms | 57 ms | 64 ms | 76 ms | 57 ms |
| DI container created | 59 ms | 60 ms | 66 ms | 78 ms | 59 ms |
| workbench mounted | 75 ms | 76 ms | 81 ms | 93 ms | 73 ms |
| first frame | 75 ms | 76 ms | 81 ms | 93 ms | 73 ms |
| workbench activated | 78 ms | 79 ms | 83 ms | 96 ms | 75 ms |
| grammars preloaded | 85 ms | 84 ms | 86 ms | 99 ms | 77 ms |
| file read from disk | 86 ms | 85 ms | 93 ms | 147 ms | 84 ms |
| file decoded | 86 ms | 85 ms | 93 ms | 147 ms | 84 ms |
| document built | 86 ms | 86 ms | 93 ms | 147 ms | 84 ms |
| tokenizer attached to editor | 96 ms | 98 ms | 110 ms | 165 ms | — |
| tabs opened | 88 ms | 89 ms | 99 ms | 153 ms | 95 ms |
| built-in extensions registered | 177 ms | 181 ms | 190 ms | 237 ms | 126 ms |
| frame with file text | 95 ms | 97 ms | 108 ms | 162 ms | 103 ms |
| frame with highlighting | 163 ms | 167 ms | 177 ms | 224 ms | — |
| extension host up | 303 ms | 326 ms | 357 ms | 607 ms | 233 ms |
| startup complete | 174 ms | 179 ms | 187 ms | 234 ms | 122 ms |
| to text (black box) | 97 ms | 99 ms | 109 ms | 164 ms | 104 ms |
| to highlight (black box) | 164 ms | 168 ms | 177 ms | 224 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 2 ms | 2 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 10 ms | 4 ms | 5 ms | 4 ms | 6 ms | 2 ms | 2 ms |
| `medium` | 12 ms | 7 ms | 5 ms | 4 ms | 6 ms | 3 ms | 2 ms |
| `large` | 21 ms | 13 ms | 12 ms | 11 ms | 37 ms | 9 ms | 11 ms |
| `xlarge` | 24 ms | 15 ms | 10 ms | 12 ms | 119 ms | 8 ms | 47 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
