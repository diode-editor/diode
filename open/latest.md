# File open benchmark

- Recorded: 2026-10-26T09:01:58.261Z, commit `c398c3a1a9ee`, diode nightly-c398c3a
- Machine: INTEL(R) XEON(R) PLATINUM 8573C (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 23 ms; binary floor (`diode --version` over PTY, median): 57 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **121 ms** | 87 ms | 144 ms | 249 ms | 6 ms | 254 MB | 11 |
| `medium` | 126.7 KB | 2000 | **121 ms** | 87 ms | 143 ms | 247 ms | 14 ms | 281 MB | 11 |
| `large` | 1.3 MB | 20000 | **126 ms** | 92 ms | 149 ms | 248 ms | 5 ms | 301 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **207 ms** | 173 ms | 230 ms | 318 ms | 5 ms | 368 MB | 5 |
| `log500m` | 497 MB | 5295839 | **123 ms** | 89 ms | 146 ms | — (plaintext) | 5 ms | 269 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 5 ms | 5 ms | 7 ms | 5 ms |
| node ready (bootstrapComplete) | 59 ms | 57 ms | 56 ms | 64 ms | 53 ms |
| bundle executed (main:start) | 59 ms | 58 ms | 56 ms | 64 ms | 53 ms |
| config loaded | 74 ms | 72 ms | 71 ms | 79 ms | 67 ms |
| keybindings loaded | 75 ms | 73 ms | 71 ms | 79 ms | 68 ms |
| session state loaded | 75 ms | 73 ms | 72 ms | 80 ms | 68 ms |
| extensions scanned | 72 ms | 70 ms | 69 ms | 76 ms | 65 ms |
| themes ready | 79 ms | 77 ms | 75 ms | 84 ms | 72 ms |
| DI container created | 83 ms | 81 ms | 78 ms | 87 ms | 75 ms |
| workbench mounted | 111 ms | 108 ms | 103 ms | 113 ms | 103 ms |
| first frame | 111 ms | 108 ms | 103 ms | 113 ms | 103 ms |
| workbench activated | 115 ms | 113 ms | 106 ms | 118 ms | 107 ms |
| grammars preloaded | 124 ms | 123 ms | 114 ms | 127 ms | 113 ms |
| file read from disk | 126 ms | 127 ms | 128 ms | 208 ms | 122 ms |
| file decoded | 126 ms | 127 ms | 128 ms | 208 ms | 122 ms |
| document built | 126 ms | 127 ms | 129 ms | 209 ms | 122 ms |
| tokenizer attached to editor | 143 ms | 145 ms | 149 ms | 230 ms | — |
| tabs opened | 129 ms | 132 ms | 136 ms | 216 ms | 136 ms |
| built-in extensions registered | 265 ms | 263 ms | 264 ms | 333 ms | 173 ms |
| frame with file text | 142 ms | 143 ms | 148 ms | 228 ms | 146 ms |
| frame with highlighting | 249 ms | 247 ms | 248 ms | 318 ms | — |
| extension host up | 468 ms | 474 ms | 503 ms | 812 ms | 329 ms |
| startup complete | 259 ms | 257 ms | 258 ms | 327 ms | 167 ms |
| to text (black box) | 144 ms | 143 ms | 149 ms | 230 ms | 146 ms |
| to highlight (black box) | 249 ms | 247 ms | 248 ms | 318 ms | — |
| gap black − white (text) | 3 ms | 2 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 30 ms | 12 ms | 7 ms | 7 ms | 11 ms | 5 ms | 3 ms |
| `medium` | 27 ms | 9 ms | 10 ms | 8 ms | 11 ms | 6 ms | 3 ms |
| `large` | 28 ms | 18 ms | 12 ms | 13 ms | 38 ms | 11 ms | 15 ms |
| `xlarge` | 24 ms | 21 ms | 12 ms | 15 ms | 120 ms | 12 ms | 74 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
