# File open benchmark

- Recorded: 2026-10-26T02:46:58.171Z, commit `bf519b0add1c`, diode nightly-bf519b0
- Machine: AMD EPYC 9V45 96-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 21 ms; binary floor (`diode --version` over PTY, median): 45 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **99 ms** | 75 ms | 120 ms | 196 ms | 18 ms | 253 MB | 11 |
| `medium` | 126.7 KB | 2000 | **99 ms** | 75 ms | 120 ms | 197 ms | 12 ms | 270 MB | 11 |
| `large` | 1.3 MB | 20000 | **99 ms** | 75 ms | 120 ms | 199 ms | 9 ms | 300 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **156 ms** | 132 ms | 177 ms | 247 ms | 11 ms | 366 MB | 5 |
| `log500m` | 497 MB | 5295839 | **103 ms** | 79 ms | 124 ms | — (plaintext) | 6 ms | 312 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 5 ms | 6 ms | 7 ms | 5 ms |
| node ready (bootstrapComplete) | 49 ms | 53 ms | 50 ms | 60 ms | 47 ms |
| bundle executed (main:start) | 49 ms | 53 ms | 50 ms | 60 ms | 47 ms |
| config loaded | 64 ms | 65 ms | 66 ms | 78 ms | 66 ms |
| keybindings loaded | 65 ms | 66 ms | 66 ms | 78 ms | 66 ms |
| session state loaded | 65 ms | 66 ms | 66 ms | 78 ms | 66 ms |
| extensions scanned | 62 ms | 63 ms | 63 ms | 74 ms | 64 ms |
| themes ready | 68 ms | 69 ms | 68 ms | 80 ms | 68 ms |
| DI container created | 70 ms | 71 ms | 70 ms | 82 ms | 71 ms |
| workbench mounted | 92 ms | 92 ms | 87 ms | 101 ms | 88 ms |
| first frame | 92 ms | 92 ms | 87 ms | 101 ms | 88 ms |
| workbench activated | 95 ms | 95 ms | 90 ms | 103 ms | 91 ms |
| grammars preloaded | 103 ms | 100 ms | 96 ms | 107 ms | 93 ms |
| file read from disk | 105 ms | 102 ms | 104 ms | 161 ms | 101 ms |
| file decoded | 105 ms | 102 ms | 104 ms | 161 ms | 101 ms |
| document built | 105 ms | 102 ms | 104 ms | 162 ms | 101 ms |
| tokenizer attached to editor | 118 ms | 119 ms | 120 ms | 179 ms | — |
| tabs opened | 107 ms | 107 ms | 110 ms | 168 ms | 115 ms |
| built-in extensions registered | 210 ms | 212 ms | 212 ms | 260 ms | 151 ms |
| frame with file text | 117 ms | 118 ms | 118 ms | 176 ms | 123 ms |
| frame with highlighting | 196 ms | 197 ms | 199 ms | 247 ms | — |
| extension host up | 367 ms | 386 ms | 415 ms | 672 ms | 280 ms |
| startup complete | 206 ms | 208 ms | 209 ms | 257 ms | 147 ms |
| to text (black box) | 120 ms | 120 ms | 120 ms | 177 ms | 124 ms |
| to highlight (black box) | 196 ms | 197 ms | 199 ms | 247 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 1 ms | 2 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 14 ms | 9 ms | 8 ms | 6 ms | 8 ms | 5 ms | 2 ms |
| `medium` | 21 ms | 8 ms | 8 ms | 6 ms | 10 ms | 4 ms | 2 ms |
| `large` | 26 ms | 17 ms | 12 ms | 12 ms | 49 ms | 9 ms | 10 ms |
| `xlarge` | 22 ms | 20 ms | 10 ms | 15 ms | 113 ms | 11 ms | 50 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
