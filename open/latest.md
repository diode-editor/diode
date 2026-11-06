# File open benchmark

- Recorded: 2026-11-06T08:23:20.753Z, commit `96e7edf0cc6a`, diode nightly-96e7edf
- Machine: AMD EPYC 9V45 96-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 19 ms; binary floor (`diode --version` over PTY, median): 47 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **106 ms** | 78 ms | 125 ms | 202 ms | 9 ms | 268 MB | 11 |
| `medium` | 126.7 KB | 2000 | **107 ms** | 79 ms | 126 ms | 202 ms | 15 ms | 286 MB | 11 |
| `large` | 1.3 MB | 20000 | **121 ms** | 93 ms | 140 ms | 219 ms | 19 ms | 296 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **183 ms** | 155 ms | 202 ms | 272 ms | 5 ms | 354 MB | 5 |
| `log500m` | 497 MB | 5295839 | **102 ms** | 74 ms | 121 ms | — (plaintext) | 5 ms | 310 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 5 ms | 9 ms | 10 ms | 5 ms |
| node ready (bootstrapComplete) | 54 ms | 55 ms | 59 ms | 66 ms | 47 ms |
| bundle executed (main:start) | 54 ms | 55 ms | 59 ms | 66 ms | 47 ms |
| config loaded | 66 ms | 71 ms | 73 ms | 89 ms | 62 ms |
| keybindings loaded | 67 ms | 71 ms | 73 ms | 91 ms | 62 ms |
| session state loaded | 67 ms | 72 ms | 73 ms | 91 ms | 62 ms |
| extensions scanned | 64 ms | 68 ms | 70 ms | 85 ms | 57 ms |
| themes ready | 70 ms | 75 ms | 76 ms | 94 ms | 66 ms |
| DI container created | 73 ms | 79 ms | 79 ms | 97 ms | 68 ms |
| workbench mounted | 96 ms | 99 ms | 101 ms | 118 ms | 86 ms |
| first frame | 96 ms | 99 ms | 101 ms | 118 ms | 86 ms |
| workbench activated | 100 ms | 102 ms | 104 ms | 122 ms | 89 ms |
| grammars preloaded | 108 ms | 106 ms | 113 ms | 129 ms | 91 ms |
| file read from disk | 110 ms | 109 ms | 122 ms | 181 ms | 99 ms |
| file decoded | 110 ms | 109 ms | 123 ms | 181 ms | 99 ms |
| document built | 110 ms | 110 ms | 123 ms | 181 ms | 99 ms |
| tokenizer attached to editor | 124 ms | 129 ms | 140 ms | 202 ms | — |
| tabs opened | 114 ms | 114 ms | 129 ms | 189 ms | 110 ms |
| built-in extensions registered | 220 ms | 223 ms | 237 ms | 291 ms | 152 ms |
| frame with file text | 124 ms | 125 ms | 138 ms | 201 ms | 121 ms |
| frame with highlighting | 202 ms | 201 ms | 219 ms | 272 ms | — |
| extension host up | 392 ms | 413 ms | 461 ms | 812 ms | 288 ms |
| startup complete | 215 ms | 216 ms | 232 ms | 285 ms | 145 ms |
| to text (black box) | 125 ms | 126 ms | 140 ms | 202 ms | 121 ms |
| to highlight (black box) | 202 ms | 202 ms | 219 ms | 272 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 1 ms | 2 ms | 2 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 11 ms | 7 ms | 6 ms | 5 ms | — | 5 ms | 2 ms |
| `medium` failed | 23 ms | 10 ms | 7 ms | 7 ms | — | 5 ms | 4 ms |
| `large` failed | 39 ms | 18 ms | 18 ms | 16 ms | — | 19 ms | 17 ms |
| `xlarge` failed | 25 ms | 37 ms | 19 ms | 40 ms | — | 15 ms | 47 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
