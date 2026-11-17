# File open benchmark

- Recorded: 2026-11-17T21:11:33.446Z, commit `5e6fdf90d119`, diode nightly-5e6fdf9
- Machine: AMD EPYC 9V45 96-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 17 ms; binary floor (`diode --version` over PTY, median): 47 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **110 ms** | 80 ms | 127 ms | 202 ms | 6 ms | 270 MB | 11 |
| `medium` | 126.7 KB | 2000 | **107 ms** | 77 ms | 124 ms | 197 ms | 7 ms | 293 MB | 11 |
| `large` | 1.3 MB | 20000 | **123 ms** | 92 ms | 139 ms | 206 ms | 4 ms | 313 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **176 ms** | 146 ms | 193 ms | 250 ms | 5 ms | 366 MB | 5 |
| `log500m` | 497 MB | 5295839 | **117 ms** | 87 ms | 134 ms | — (plaintext) | 3 ms | 332 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 5 ms | 7 ms | 8 ms | 5 ms |
| node ready (bootstrapComplete) | 52 ms | 52 ms | 59 ms | 61 ms | 50 ms |
| bundle executed (main:start) | 52 ms | 52 ms | 59 ms | 61 ms | 50 ms |
| config loaded | 66 ms | 66 ms | 72 ms | 87 ms | 66 ms |
| keybindings loaded | 66 ms | 66 ms | 72 ms | 87 ms | 67 ms |
| session state loaded | 66 ms | 66 ms | 72 ms | 87 ms | 67 ms |
| extensions scanned | 61 ms | 63 ms | 68 ms | 79 ms | 62 ms |
| themes ready | 69 ms | 68 ms | 75 ms | 90 ms | 70 ms |
| DI container created | 72 ms | 71 ms | 78 ms | 92 ms | 72 ms |
| workbench mounted | 99 ms | 95 ms | 104 ms | 115 ms | 96 ms |
| first frame | 99 ms | 95 ms | 104 ms | 115 ms | 96 ms |
| workbench activated | 104 ms | 100 ms | 109 ms | 120 ms | 101 ms |
| grammars preloaded | 111 ms | 107 ms | 114 ms | 125 ms | 104 ms |
| file read from disk | 112 ms | 109 ms | 122 ms | 172 ms | 111 ms |
| file decoded | 112 ms | 109 ms | 122 ms | 172 ms | 111 ms |
| document built | 113 ms | 109 ms | 122 ms | 173 ms | 111 ms |
| tokenizer attached to editor | 126 ms | 125 ms | 140 ms | 192 ms | — |
| tabs opened | 116 ms | 114 ms | 128 ms | 180 ms | 124 ms |
| built-in extensions registered | 219 ms | 217 ms | 225 ms | 269 ms | 165 ms |
| frame with file text | 125 ms | 123 ms | 137 ms | 190 ms | 134 ms |
| frame with highlighting | 201 ms | 197 ms | 206 ms | 250 ms | — |
| extension host up | 376 ms | 388 ms | 455 ms | 767 ms | 286 ms |
| startup complete | 214 ms | 210 ms | 219 ms | 263 ms | 158 ms |
| to text (black box) | 127 ms | 124 ms | 139 ms | 193 ms | 134 ms |
| to highlight (black box) | 202 ms | 197 ms | 206 ms | 250 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 2 ms | 3 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 10 ms | 5 ms | 6 ms | 5 ms | — | 3 ms | 2 ms |
| `medium` failed | 19 ms | 9 ms | 7 ms | 8 ms | — | 3 ms | 3 ms |
| `large` failed | 31 ms | 20 ms | 15 ms | 12 ms | — | 12 ms | 16 ms |
| `xlarge` failed | 25 ms | 31 ms | 15 ms | 19 ms | — | 11 ms | 40 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
