# File open benchmark

- Recorded: 2026-11-09T11:06:50.598Z, commit `bd2f74f2bdcb`, diode nightly-bd2f74f
- Machine: AMD EPYC 9V45 96-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 20 ms; binary floor (`diode --version` over PTY, median): 51 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **111 ms** | 80 ms | 131 ms | 204 ms | 11 ms | 272 MB | 11 |
| `medium` | 126.7 KB | 2000 | **118 ms** | 87 ms | 138 ms | 214 ms | 6 ms | 289 MB | 11 |
| `large` | 1.3 MB | 20000 | **140 ms** | 109 ms | 160 ms | 235 ms | 8 ms | 304 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **196 ms** | 165 ms | 216 ms | 286 ms | 9 ms | 358 MB | 5 |
| `log500m` | 497 MB | 5295839 | **126 ms** | 95 ms | 146 ms | — (plaintext) | 3 ms | 278 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 6 ms | 9 ms | 9 ms | 5 ms |
| node ready (bootstrapComplete) | 52 ms | 55 ms | 62 ms | 76 ms | 53 ms |
| bundle executed (main:start) | 52 ms | 55 ms | 62 ms | 76 ms | 53 ms |
| config loaded | 69 ms | 69 ms | 76 ms | 98 ms | 67 ms |
| keybindings loaded | 69 ms | 69 ms | 76 ms | 98 ms | 67 ms |
| session state loaded | 69 ms | 69 ms | 76 ms | 98 ms | 67 ms |
| extensions scanned | 67 ms | 67 ms | 73 ms | 90 ms | 64 ms |
| themes ready | 72 ms | 73 ms | 80 ms | 101 ms | 70 ms |
| DI container created | 75 ms | 76 ms | 83 ms | 103 ms | 74 ms |
| workbench mounted | 101 ms | 104 ms | 113 ms | 131 ms | 101 ms |
| first frame | 101 ms | 103 ms | 113 ms | 131 ms | 101 ms |
| workbench activated | 107 ms | 110 ms | 119 ms | 137 ms | 108 ms |
| grammars preloaded | 113 ms | 117 ms | 129 ms | 144 ms | 114 ms |
| file read from disk | 115 ms | 119 ms | 137 ms | 194 ms | 121 ms |
| file decoded | 115 ms | 119 ms | 137 ms | 194 ms | 122 ms |
| document built | 115 ms | 120 ms | 137 ms | 195 ms | 122 ms |
| tokenizer attached to editor | 131 ms | 138 ms | 159 ms | 216 ms | — |
| tabs opened | 119 ms | 125 ms | 144 ms | 202 ms | 134 ms |
| built-in extensions registered | 224 ms | 235 ms | 257 ms | 306 ms | 179 ms |
| frame with file text | 130 ms | 136 ms | 157 ms | 214 ms | 144 ms |
| frame with highlighting | 204 ms | 214 ms | 235 ms | 286 ms | — |
| extension host up | 395 ms | 428 ms | 512 ms | 856 ms | 337 ms |
| startup complete | 218 ms | 228 ms | 250 ms | 299 ms | 170 ms |
| to text (black box) | 131 ms | 138 ms | 160 ms | 216 ms | 146 ms |
| to highlight (black box) | 204 ms | 214 ms | 235 ms | 286 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 1 ms | 2 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 11 ms | 8 ms | 5 ms | 7 ms | — | 4 ms | 3 ms |
| `medium` failed | 22 ms | 11 ms | 8 ms | 7 ms | — | 3 ms | 4 ms |
| `large` failed | 36 ms | 26 ms | 19 ms | 16 ms | — | 14 ms | 14 ms |
| `xlarge` failed | 23 ms | 25 ms | 24 ms | 32 ms | — | 15 ms | 50 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
