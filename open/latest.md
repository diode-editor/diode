# File open benchmark

- Recorded: 2026-11-05T21:42:29.107Z, commit `4dc9d5c6b96b`, diode nightly-4dc9d5c
- Machine: AMD EPYC 9V45 96-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 20 ms; binary floor (`diode --version` over PTY, median): 51 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **102 ms** | 71 ms | 122 ms | 196 ms | 5 ms | 268 MB | 11 |
| `medium` | 126.7 KB | 2000 | **106 ms** | 75 ms | 126 ms | 212 ms | 11 ms | 285 MB | 11 |
| `large` | 1.3 MB | 20000 | **123 ms** | 92 ms | 143 ms | 225 ms | 15 ms | 295 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **181 ms** | 150 ms | 201 ms | 268 ms | 6 ms | 354 MB | 5 |
| `log500m` | 497 MB | 5295839 | **112 ms** | 81 ms | 132 ms | — (plaintext) | 1 ms | 312 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 6 ms | 8 ms | 11 ms | 5 ms |
| node ready (bootstrapComplete) | 53 ms | 53 ms | 61 ms | 68 ms | 50 ms |
| bundle executed (main:start) | 53 ms | 54 ms | 61 ms | 68 ms | 50 ms |
| config loaded | 66 ms | 70 ms | 75 ms | 92 ms | 64 ms |
| keybindings loaded | 66 ms | 70 ms | 77 ms | 92 ms | 67 ms |
| session state loaded | 66 ms | 71 ms | 77 ms | 92 ms | 67 ms |
| extensions scanned | 63 ms | 68 ms | 71 ms | 90 ms | 61 ms |
| themes ready | 69 ms | 74 ms | 80 ms | 95 ms | 69 ms |
| DI container created | 72 ms | 76 ms | 82 ms | 97 ms | 72 ms |
| workbench mounted | 95 ms | 95 ms | 104 ms | 117 ms | 92 ms |
| first frame | 95 ms | 95 ms | 104 ms | 117 ms | 92 ms |
| workbench activated | 99 ms | 99 ms | 108 ms | 120 ms | 97 ms |
| grammars preloaded | 106 ms | 106 ms | 116 ms | 124 ms | 101 ms |
| file read from disk | 108 ms | 110 ms | 124 ms | 180 ms | 108 ms |
| file decoded | 108 ms | 110 ms | 124 ms | 180 ms | 108 ms |
| document built | 108 ms | 110 ms | 124 ms | 180 ms | 109 ms |
| tokenizer attached to editor | 122 ms | 127 ms | 143 ms | 202 ms | — |
| tabs opened | 111 ms | 115 ms | 131 ms | 187 ms | 123 ms |
| built-in extensions registered | 214 ms | 231 ms | 243 ms | 287 ms | 163 ms |
| frame with file text | 121 ms | 125 ms | 142 ms | 200 ms | 132 ms |
| frame with highlighting | 196 ms | 212 ms | 225 ms | 267 ms | — |
| extension host up | 383 ms | 433 ms | 483 ms | 821 ms | 327 ms |
| startup complete | 209 ms | 225 ms | 238 ms | 280 ms | 156 ms |
| to text (black box) | 122 ms | 126 ms | 143 ms | 201 ms | 132 ms |
| to highlight (black box) | 196 ms | 212 ms | 225 ms | 268 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 1 ms | 2 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 11 ms | 8 ms | 5 ms | 9 ms | — | 4 ms | 2 ms |
| `medium` failed | 25 ms | 12 ms | 7 ms | 9 ms | — | 6 ms | 4 ms |
| `large` failed | 29 ms | 21 ms | 20 ms | 16 ms | — | 14 ms | 11 ms |
| `xlarge` failed | 26 ms | 39 ms | 17 ms | 22 ms | — | 18 ms | 48 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
