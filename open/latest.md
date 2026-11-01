# File open benchmark

- Recorded: 2026-11-01T01:03:30.261Z, commit `414c19d0653b`, diode nightly-414c19d
- Machine: Intel(R) Xeon(R) Platinum 8370C CPU @ 2.80GHz (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 23 ms; binary floor (`diode --version` over PTY, median): 57 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **131 ms** | 97 ms | 154 ms | 272 ms | 6 ms | 255 MB | 11 |
| `medium` | 126.7 KB | 2000 | **135 ms** | 100 ms | 158 ms | 275 ms | 5 ms | 281 MB | 11 |
| `large` | 1.3 MB | 20000 | **144 ms** | 110 ms | 167 ms | 304 ms | 7 ms | 295 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **232 ms** | 198 ms | 255 ms | 383 ms | 13 ms | 371 MB | 5 |
| `log500m` | 497 MB | 5295839 | **143 ms** | 108 ms | 165 ms | — (plaintext) | 1 ms | 271 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 6 ms | 6 ms | 4 ms |
| node ready (bootstrapComplete) | 62 ms | 61 ms | 62 ms | 73 ms | 57 ms |
| bundle executed (main:start) | 62 ms | 61 ms | 62 ms | 73 ms | 57 ms |
| config loaded | 78 ms | 79 ms | 76 ms | 90 ms | 72 ms |
| keybindings loaded | 79 ms | 79 ms | 77 ms | 92 ms | 72 ms |
| session state loaded | 79 ms | 79 ms | 77 ms | 92 ms | 73 ms |
| extensions scanned | 74 ms | 75 ms | 73 ms | 86 ms | 69 ms |
| themes ready | 83 ms | 84 ms | 81 ms | 96 ms | 78 ms |
| DI container created | 88 ms | 88 ms | 85 ms | 100 ms | 82 ms |
| workbench mounted | 118 ms | 117 ms | 117 ms | 131 ms | 113 ms |
| first frame | 118 ms | 117 ms | 117 ms | 131 ms | 113 ms |
| workbench activated | 123 ms | 122 ms | 121 ms | 136 ms | 118 ms |
| grammars preloaded | 134 ms | 132 ms | 130 ms | 146 ms | 123 ms |
| file read from disk | 136 ms | 136 ms | 143 ms | 232 ms | 132 ms |
| file decoded | 136 ms | 136 ms | 143 ms | 232 ms | 132 ms |
| document built | 136 ms | 137 ms | 143 ms | 232 ms | 132 ms |
| tokenizer attached to editor | 154 ms | 163 ms | 182 ms | 271 ms | — |
| tabs opened | 139 ms | 142 ms | 151 ms | 242 ms | 150 ms |
| built-in extensions registered | 293 ms | 297 ms | 321 ms | 401 ms | 199 ms |
| frame with file text | 152 ms | 155 ms | 165 ms | 255 ms | 165 ms |
| frame with highlighting | 272 ms | 275 ms | 304 ms | 383 ms | — |
| extension host up | 513 ms | 539 ms | 603 ms | 1014 ms | 373 ms |
| startup complete | 286 ms | 290 ms | 316 ms | 395 ms | 193 ms |
| to text (black box) | 154 ms | 158 ms | 167 ms | 255 ms | 165 ms |
| to highlight (black box) | 272 ms | 275 ms | 304 ms | 383 ms | — |
| gap black − white (text) | 3 ms | 3 ms | 2 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 35 ms | 9 ms | 10 ms | 12 ms | 15 ms | 6 ms | 4 ms |
| `medium` | 35 ms | 13 ms | 10 ms | 10 ms | 16 ms | 9 ms | 4 ms |
| `large` | 34 ms | 24 ms | 19 ms | 16 ms | 45 ms | 13 ms | 16 ms |
| `xlarge` | 26 ms | 30 ms | 21 ms | 20 ms | 118 ms | 15 ms | 78 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
