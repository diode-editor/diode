# File open benchmark

- Recorded: 2026-11-04T03:09:43.684Z, commit `ebdd51d2e666`, diode nightly-ebdd51d
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 21 ms; binary floor (`diode --version` over PTY, median): 54 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **113 ms** | 80 ms | 133 ms | 225 ms | 4 ms | 268 MB | 11 |
| `medium` | 126.7 KB | 2000 | **113 ms** | 80 ms | 134 ms | 224 ms | 8 ms | 281 MB | 11 |
| `large` | 1.3 MB | 20000 | **125 ms** | 92 ms | 146 ms | 235 ms | 10 ms | 298 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **204 ms** | 171 ms | 224 ms | 299 ms | 9 ms | 350 MB | 5 |
| `log500m` | 497 MB | 5295839 | **127 ms** | 94 ms | 147 ms | — (plaintext) | 2 ms | 272 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 5 ms | 6 ms | 7 ms | 5 ms |
| node ready (bootstrapComplete) | 58 ms | 58 ms | 60 ms | 73 ms | 54 ms |
| bundle executed (main:start) | 58 ms | 58 ms | 60 ms | 73 ms | 54 ms |
| config loaded | 75 ms | 74 ms | 77 ms | 90 ms | 70 ms |
| keybindings loaded | 76 ms | 74 ms | 77 ms | 91 ms | 70 ms |
| session state loaded | 76 ms | 74 ms | 77 ms | 91 ms | 71 ms |
| extensions scanned | 72 ms | 70 ms | 75 ms | 85 ms | 68 ms |
| themes ready | 79 ms | 77 ms | 80 ms | 95 ms | 74 ms |
| DI container created | 81 ms | 82 ms | 82 ms | 98 ms | 78 ms |
| workbench mounted | 104 ms | 104 ms | 106 ms | 122 ms | 103 ms |
| first frame | 104 ms | 104 ms | 106 ms | 122 ms | 103 ms |
| workbench activated | 108 ms | 108 ms | 110 ms | 126 ms | 108 ms |
| grammars preloaded | 114 ms | 114 ms | 119 ms | 133 ms | 113 ms |
| file read from disk | 116 ms | 118 ms | 128 ms | 200 ms | 122 ms |
| file decoded | 116 ms | 118 ms | 128 ms | 200 ms | 122 ms |
| document built | 116 ms | 118 ms | 128 ms | 200 ms | 122 ms |
| tokenizer attached to editor | 132 ms | 135 ms | 147 ms | 223 ms | — |
| tabs opened | 119 ms | 124 ms | 135 ms | 208 ms | 137 ms |
| built-in extensions registered | 242 ms | 241 ms | 254 ms | 317 ms | 181 ms |
| frame with file text | 132 ms | 134 ms | 145 ms | 221 ms | 147 ms |
| frame with highlighting | 225 ms | 223 ms | 235 ms | 298 ms | — |
| extension host up | 430 ms | 468 ms | 520 ms | 887 ms | 329 ms |
| startup complete | 237 ms | 236 ms | 248 ms | 312 ms | 175 ms |
| to text (black box) | 133 ms | 134 ms | 146 ms | 224 ms | 147 ms |
| to highlight (black box) | 225 ms | 224 ms | 235 ms | 299 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 1 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 26 ms | 9 ms | 8 ms | 7 ms | — | 6 ms | 3 ms |
| `medium` failed | 24 ms | 10 ms | 8 ms | 9 ms | — | 5 ms | 4 ms |
| `large` failed | 26 ms | 23 ms | 16 ms | 15 ms | — | 18 ms | 14 ms |
| `xlarge` failed | 36 ms | 34 ms | 19 ms | 20 ms | — | 18 ms | 73 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
