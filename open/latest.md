# File open benchmark

- Recorded: 2026-11-16T01:43:40.463Z, commit `2bebdafa8d53`, diode nightly-2bebdaf
- Machine: Intel(R) Xeon(R) 6975P-C (4 cores, 15 GB), linux 7.0.0-1016-aws
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 18 ms; binary floor (`diode --version` over PTY, median): 52 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **121 ms** | 86 ms | 138 ms | 225 ms | 4 ms | 267 MB | 11 |
| `medium` | 126.7 KB | 2000 | **119 ms** | 85 ms | 137 ms | 221 ms | 4 ms | 291 MB | 11 |
| `large` | 1.3 MB | 20000 | **128 ms** | 94 ms | 146 ms | 233 ms | 11 ms | 303 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **201 ms** | 167 ms | 219 ms | 290 ms | 13 ms | 358 MB | 5 |
| `log500m` | 497 MB | 5295839 | **126 ms** | 92 ms | 143 ms | — (plaintext) | 1 ms | 283 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 5 ms | 5 ms | 9 ms | 4 ms |
| node ready (bootstrapComplete) | 54 ms | 55 ms | 56 ms | 63 ms | 53 ms |
| bundle executed (main:start) | 54 ms | 55 ms | 57 ms | 63 ms | 53 ms |
| config loaded | 69 ms | 71 ms | 72 ms | 77 ms | 65 ms |
| keybindings loaded | 69 ms | 72 ms | 73 ms | 77 ms | 66 ms |
| session state loaded | 69 ms | 72 ms | 73 ms | 77 ms | 66 ms |
| extensions scanned | 66 ms | 66 ms | 69 ms | 74 ms | 61 ms |
| themes ready | 73 ms | 75 ms | 76 ms | 81 ms | 69 ms |
| DI container created | 76 ms | 77 ms | 79 ms | 84 ms | 72 ms |
| workbench mounted | 106 ms | 105 ms | 107 ms | 114 ms | 102 ms |
| first frame | 106 ms | 105 ms | 107 ms | 114 ms | 102 ms |
| workbench activated | 112 ms | 111 ms | 112 ms | 120 ms | 108 ms |
| grammars preloaded | 120 ms | 116 ms | 116 ms | 130 ms | 113 ms |
| file read from disk | 122 ms | 119 ms | 125 ms | 200 ms | 121 ms |
| file decoded | 122 ms | 119 ms | 125 ms | 200 ms | 121 ms |
| document built | 122 ms | 119 ms | 125 ms | 201 ms | 121 ms |
| tokenizer attached to editor | 136 ms | 137 ms | 147 ms | 220 ms | — |
| tabs opened | 125 ms | 123 ms | 131 ms | 208 ms | 133 ms |
| built-in extensions registered | 244 ms | 241 ms | 251 ms | 305 ms | 173 ms |
| frame with file text | 136 ms | 134 ms | 146 ms | 219 ms | 143 ms |
| frame with highlighting | 225 ms | 221 ms | 233 ms | 290 ms | — |
| extension host up | 418 ms | 434 ms | 474 ms | 870 ms | 320 ms |
| startup complete | 237 ms | 233 ms | 243 ms | 299 ms | 166 ms |
| to text (black box) | 138 ms | 137 ms | 146 ms | 219 ms | 143 ms |
| to highlight (black box) | 225 ms | 221 ms | 233 ms | 290 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 1 ms | 2 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 23 ms | 12 ms | 8 ms | 7 ms | — | 4 ms | 3 ms |
| `medium` failed | 26 ms | 12 ms | 8 ms | 6 ms | — | 4 ms | 4 ms |
| `large` failed | 33 ms | 16 ms | 15 ms | 18 ms | — | 18 ms | 16 ms |
| `xlarge` failed | 26 ms | 30 ms | 13 ms | 20 ms | — | 17 ms | 70 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
