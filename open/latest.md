# File open benchmark

- Recorded: 2026-11-10T20:43:35.492Z, commit `6e801fa955b6`, diode nightly-6e801fa
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 21 ms; binary floor (`diode --version` over PTY, median): 59 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **130 ms** | 92 ms | 151 ms | 238 ms | 6 ms | 278 MB | 11 |
| `medium` | 126.7 KB | 2000 | **126 ms** | 88 ms | 147 ms | 242 ms | 8 ms | 288 MB | 11 |
| `large` | 1.3 MB | 20000 | **140 ms** | 102 ms | 161 ms | 251 ms | 5 ms | 301 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **209 ms** | 172 ms | 231 ms | 310 ms | 23 ms | 355 MB | 5 |
| `log500m` | 497 MB | 5295839 | **139 ms** | 101 ms | 160 ms | — (plaintext) | 2 ms | 279 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 6 ms | 6 ms | 5 ms |
| node ready (bootstrapComplete) | 62 ms | 61 ms | 62 ms | 76 ms | 58 ms |
| bundle executed (main:start) | 62 ms | 61 ms | 62 ms | 76 ms | 58 ms |
| config loaded | 81 ms | 80 ms | 77 ms | 95 ms | 72 ms |
| keybindings loaded | 82 ms | 81 ms | 80 ms | 95 ms | 72 ms |
| session state loaded | 82 ms | 81 ms | 80 ms | 95 ms | 72 ms |
| extensions scanned | 76 ms | 76 ms | 74 ms | 92 ms | 69 ms |
| themes ready | 87 ms | 84 ms | 82 ms | 97 ms | 76 ms |
| DI container created | 90 ms | 87 ms | 85 ms | 101 ms | 79 ms |
| workbench mounted | 120 ms | 115 ms | 117 ms | 134 ms | 112 ms |
| first frame | 120 ms | 115 ms | 117 ms | 134 ms | 112 ms |
| workbench activated | 126 ms | 121 ms | 123 ms | 140 ms | 118 ms |
| grammars preloaded | 132 ms | 125 ms | 132 ms | 144 ms | 124 ms |
| file read from disk | 134 ms | 127 ms | 141 ms | 206 ms | 134 ms |
| file decoded | 134 ms | 127 ms | 141 ms | 206 ms | 134 ms |
| document built | 134 ms | 128 ms | 141 ms | 207 ms | 134 ms |
| tokenizer attached to editor | 153 ms | 148 ms | 162 ms | 233 ms | — |
| tabs opened | 138 ms | 132 ms | 148 ms | 215 ms | 148 ms |
| built-in extensions registered | 263 ms | 264 ms | 272 ms | 332 ms | 203 ms |
| frame with file text | 150 ms | 146 ms | 160 ms | 231 ms | 160 ms |
| frame with highlighting | 237 ms | 241 ms | 251 ms | 310 ms | — |
| extension host up | 474 ms | 504 ms | 539 ms | 930 ms | 361 ms |
| startup complete | 255 ms | 256 ms | 265 ms | 324 ms | 188 ms |
| to text (black box) | 151 ms | 147 ms | 161 ms | 231 ms | 160 ms |
| to highlight (black box) | 238 ms | 242 ms | 251 ms | 310 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 31 ms | 10 ms | 8 ms | 9 ms | — | 7 ms | 3 ms |
| `medium` failed | 28 ms | 12 ms | 10 ms | 11 ms | — | 6 ms | 4 ms |
| `large` failed | 37 ms | 18 ms | 19 ms | 16 ms | — | 17 ms | 16 ms |
| `xlarge` failed | 35 ms | 36 ms | 22 ms | 50 ms | — | 18 ms | 56 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
