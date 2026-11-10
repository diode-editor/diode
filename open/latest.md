# File open benchmark

- Recorded: 2026-11-10T11:11:46.886Z, commit `e95f7dff50f6`, diode nightly-e95f7df
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 20 ms; binary floor (`diode --version` over PTY, median): 56 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **132 ms** | 95 ms | 151 ms | 239 ms | 9 ms | 277 MB | 11 |
| `medium` | 126.7 KB | 2000 | **132 ms** | 96 ms | 152 ms | 240 ms | 4 ms | 289 MB | 11 |
| `large` | 1.3 MB | 20000 | **142 ms** | 106 ms | 162 ms | 253 ms | 6 ms | 299 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **209 ms** | 173 ms | 228 ms | 304 ms | 4 ms | 357 MB | 5 |
| `log500m` | 497 MB | 5295839 | **137 ms** | 101 ms | 157 ms | — (plaintext) | 4 ms | 311 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 6 ms | 6 ms | 7 ms | 5 ms |
| node ready (bootstrapComplete) | 61 ms | 64 ms | 63 ms | 75 ms | 56 ms |
| bundle executed (main:start) | 61 ms | 64 ms | 63 ms | 75 ms | 56 ms |
| config loaded | 80 ms | 80 ms | 83 ms | 94 ms | 75 ms |
| keybindings loaded | 80 ms | 81 ms | 83 ms | 94 ms | 77 ms |
| session state loaded | 80 ms | 81 ms | 83 ms | 95 ms | 77 ms |
| extensions scanned | 76 ms | 75 ms | 78 ms | 88 ms | 70 ms |
| themes ready | 84 ms | 86 ms | 86 ms | 97 ms | 79 ms |
| DI container created | 87 ms | 89 ms | 89 ms | 100 ms | 82 ms |
| workbench mounted | 117 ms | 117 ms | 117 ms | 130 ms | 110 ms |
| first frame | 117 ms | 117 ms | 116 ms | 130 ms | 110 ms |
| workbench activated | 123 ms | 123 ms | 122 ms | 136 ms | 116 ms |
| grammars preloaded | 132 ms | 127 ms | 127 ms | 140 ms | 119 ms |
| file read from disk | 134 ms | 130 ms | 138 ms | 202 ms | 128 ms |
| file decoded | 134 ms | 130 ms | 138 ms | 202 ms | 128 ms |
| document built | 134 ms | 130 ms | 139 ms | 202 ms | 128 ms |
| tokenizer attached to editor | 150 ms | 152 ms | 161 ms | 229 ms | — |
| tabs opened | 137 ms | 136 ms | 146 ms | 211 ms | 143 ms |
| built-in extensions registered | 263 ms | 267 ms | 276 ms | 326 ms | 192 ms |
| frame with file text | 149 ms | 150 ms | 160 ms | 227 ms | 156 ms |
| frame with highlighting | 239 ms | 240 ms | 253 ms | 304 ms | — |
| extension host up | 457 ms | 515 ms | 558 ms | 923 ms | 368 ms |
| startup complete | 255 ms | 258 ms | 268 ms | 318 ms | 183 ms |
| to text (black box) | 151 ms | 152 ms | 162 ms | 228 ms | 157 ms |
| to highlight (black box) | 239 ms | 240 ms | 253 ms | 304 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 1 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 24 ms | 12 ms | 9 ms | 11 ms | — | 8 ms | 3 ms |
| `medium` failed | 26 ms | 13 ms | 11 ms | 9 ms | — | 4 ms | 5 ms |
| `large` failed | 33 ms | 19 ms | 16 ms | 16 ms | — | 22 ms | 14 ms |
| `xlarge` failed | 24 ms | 21 ms | 17 ms | 19 ms | — | 13 ms | 62 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
