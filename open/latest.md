# File open benchmark

- Recorded: 2026-11-02T23:49:16.898Z, commit `8852b2e05fa8`, diode nightly-8852b2e
- Machine: INTEL(R) XEON(R) PLATINUM 8573C (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 22 ms; binary floor (`diode --version` over PTY, median): 56 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **131 ms** | 97 ms | 153 ms | 259 ms | 19 ms | 256 MB | 11 |
| `medium` | 126.7 KB | 2000 | **125 ms** | 91 ms | 147 ms | 245 ms | 7 ms | 281 MB | 11 |
| `large` | 1.3 MB | 20000 | **132 ms** | 98 ms | 154 ms | 253 ms | 19 ms | 295 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **209 ms** | 176 ms | 231 ms | 320 ms | 2 ms | 345 MB | 5 |
| `log500m` | 497 MB | 5295839 | **132 ms** | 98 ms | 154 ms | — (plaintext) | 5 ms | 305 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 5 ms | 6 ms | 7 ms | 5 ms |
| node ready (bootstrapComplete) | 64 ms | 58 ms | 59 ms | 66 ms | 56 ms |
| bundle executed (main:start) | 64 ms | 58 ms | 59 ms | 66 ms | 56 ms |
| config loaded | 79 ms | 76 ms | 78 ms | 80 ms | 74 ms |
| keybindings loaded | 79 ms | 77 ms | 79 ms | 80 ms | 76 ms |
| session state loaded | 79 ms | 77 ms | 79 ms | 80 ms | 76 ms |
| extensions scanned | 76 ms | 72 ms | 73 ms | 76 ms | 70 ms |
| themes ready | 84 ms | 80 ms | 81 ms | 85 ms | 79 ms |
| DI container created | 88 ms | 84 ms | 84 ms | 88 ms | 82 ms |
| workbench mounted | 118 ms | 108 ms | 109 ms | 115 ms | 107 ms |
| first frame | 118 ms | 108 ms | 109 ms | 115 ms | 107 ms |
| workbench activated | 123 ms | 112 ms | 112 ms | 120 ms | 111 ms |
| grammars preloaded | 133 ms | 121 ms | 121 ms | 129 ms | 113 ms |
| file read from disk | 135 ms | 125 ms | 132 ms | 210 ms | 124 ms |
| file decoded | 135 ms | 125 ms | 132 ms | 210 ms | 124 ms |
| document built | 135 ms | 125 ms | 132 ms | 210 ms | 124 ms |
| tokenizer attached to editor | 151 ms | 146 ms | 153 ms | 233 ms | — |
| tabs opened | 138 ms | 132 ms | 139 ms | 220 ms | 140 ms |
| built-in extensions registered | 276 ms | 263 ms | 269 ms | 337 ms | 184 ms |
| frame with file text | 150 ms | 144 ms | 152 ms | 231 ms | 153 ms |
| frame with highlighting | 259 ms | 245 ms | 253 ms | 320 ms | — |
| extension host up | 463 ms | 487 ms | 536 ms | 952 ms | 344 ms |
| startup complete | 270 ms | 258 ms | 264 ms | 332 ms | 177 ms |
| to text (black box) | 153 ms | 147 ms | 154 ms | 231 ms | 154 ms |
| to highlight (black box) | 259 ms | 245 ms | 253 ms | 320 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 2 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 30 ms | 13 ms | 10 ms | 9 ms | — | 8 ms | 3 ms |
| `medium` failed | 30 ms | 13 ms | 9 ms | 8 ms | — | 6 ms | 5 ms |
| `large` failed | 33 ms | 21 ms | 17 ms | 12 ms | — | 12 ms | 17 ms |
| `xlarge` failed | 34 ms | 31 ms | 15 ms | 22 ms | — | 19 ms | 64 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
