# File open benchmark

- Recorded: 2026-11-24T22:22:03.188Z, commit `cc6d71d5f4d1`, diode nightly-cc6d71d
- Machine: Intel(R) Xeon(R) 6975P-C (4 cores, 15 GB), linux 7.0.0-1016-aws
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 19 ms; binary floor (`diode --version` over PTY, median): 58 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **132 ms** | 94 ms | 151 ms | 239 ms | 13 ms | 297 MB | 11 |
| `medium` | 126.7 KB | 2000 | **133 ms** | 94 ms | 152 ms | 243 ms | 7 ms | 304 MB | 11 |
| `large` | 1.3 MB | 20000 | **138 ms** | 99 ms | 157 ms | 241 ms | 10 ms | 318 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **205 ms** | 166 ms | 224 ms | 299 ms | 5 ms | 367 MB | 5 |
| `log500m` | 497 MB | 5295839 | **142 ms** | 103 ms | 161 ms | — (plaintext) | 4 ms | 353 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 5 ms | 6 ms | 7 ms | 4 ms |
| node ready (bootstrapComplete) | 58 ms | 59 ms | 59 ms | 66 ms | 56 ms |
| bundle executed (main:start) | 58 ms | 59 ms | 59 ms | 66 ms | 56 ms |
| config loaded | 77 ms | 76 ms | 77 ms | 81 ms | 74 ms |
| keybindings loaded | 78 ms | 76 ms | 77 ms | 82 ms | 77 ms |
| session state loaded | 78 ms | 76 ms | 77 ms | 82 ms | 77 ms |
| extensions scanned | 72 ms | 72 ms | 72 ms | 77 ms | 70 ms |
| themes ready | 82 ms | 81 ms | 80 ms | 86 ms | 80 ms |
| DI container created | 85 ms | 84 ms | 83 ms | 89 ms | 83 ms |
| workbench mounted | 118 ms | 118 ms | 117 ms | 123 ms | 113 ms |
| first frame | 118 ms | 118 ms | 117 ms | 123 ms | 113 ms |
| workbench activated | 125 ms | 126 ms | 122 ms | 130 ms | 125 ms |
| grammars preloaded | 133 ms | 133 ms | 129 ms | 139 ms | 127 ms |
| file read from disk | 135 ms | 135 ms | 138 ms | 201 ms | 135 ms |
| file decoded | 135 ms | 135 ms | 138 ms | 201 ms | 135 ms |
| document built | 135 ms | 135 ms | 138 ms | 201 ms | 135 ms |
| tokenizer attached to editor | 149 ms | 153 ms | 156 ms | 225 ms | — |
| tabs opened | 138 ms | 140 ms | 145 ms | 210 ms | 149 ms |
| built-in extensions registered | 262 ms | 263 ms | 263 ms | 320 ms | 191 ms |
| frame with file text | 149 ms | 151 ms | 154 ms | 223 ms | 160 ms |
| frame with highlighting | 239 ms | 241 ms | 240 ms | 299 ms | — |
| extension host up | 449 ms | 477 ms | 544 ms | 905 ms | 341 ms |
| startup complete | 252 ms | 254 ms | 253 ms | 311 ms | 181 ms |
| to text (black box) | 151 ms | 152 ms | 157 ms | 224 ms | 161 ms |
| to highlight (black box) | 239 ms | 243 ms | 241 ms | 299 ms | — |
| gap black − white (text) | 2 ms | 1 ms | 2 ms | 1 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 19 ms | 11 ms | 7 ms | 6 ms | — | 5 ms | 3 ms |
| `medium` failed | 24 ms | 13 ms | 10 ms | 8 ms | — | 4 ms | 5 ms |
| `large` failed | 32 ms | 28 ms | 21 ms | 18 ms | — | 15 ms | 13 ms |
| `xlarge` failed | 28 ms | 29 ms | 13 ms | 15 ms | — | 12 ms | 70 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
