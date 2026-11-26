# File open benchmark

- Recorded: 2026-11-26T02:04:12.642Z, commit `e64dcdfbf120`, diode nightly-e64dcdf
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1020-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 24 ms; binary floor (`diode --version` over PTY, median): 72 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **177 ms** | 129 ms | 201 ms | 312 ms | 11 ms | 296 MB | 11 |
| `medium` | 126.7 KB | 2000 | **174 ms** | 126 ms | 198 ms | 316 ms | 8 ms | 304 MB | 11 |
| `large` | 1.3 MB | 20000 | **201 ms** | 153 ms | 225 ms | 339 ms | 13 ms | 313 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **292 ms** | 244 ms | 316 ms | 416 ms | 17 ms | 362 MB | 5 |
| `log500m` | 497 MB | 5295839 | **187 ms** | 139 ms | 211 ms | — (plaintext) | 5 ms | 340 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 6 ms | 8 ms | 10 ms | 5 ms |
| node ready (bootstrapComplete) | 78 ms | 76 ms | 88 ms | 97 ms | 73 ms |
| bundle executed (main:start) | 78 ms | 76 ms | 88 ms | 97 ms | 73 ms |
| config loaded | 103 ms | 98 ms | 112 ms | 122 ms | 96 ms |
| keybindings loaded | 104 ms | 100 ms | 113 ms | 122 ms | 97 ms |
| session state loaded | 104 ms | 100 ms | 113 ms | 123 ms | 98 ms |
| extensions scanned | 97 ms | 92 ms | 106 ms | 115 ms | 89 ms |
| themes ready | 109 ms | 104 ms | 117 ms | 128 ms | 102 ms |
| DI container created | 113 ms | 108 ms | 121 ms | 131 ms | 106 ms |
| workbench mounted | 159 ms | 154 ms | 171 ms | 176 ms | 149 ms |
| first frame | 159 ms | 154 ms | 171 ms | 176 ms | 149 ms |
| workbench activated | 166 ms | 161 ms | 178 ms | 183 ms | 156 ms |
| grammars preloaded | 172 ms | 167 ms | 184 ms | 188 ms | 159 ms |
| file read from disk | 175 ms | 172 ms | 197 ms | 288 ms | 173 ms |
| file decoded | 175 ms | 172 ms | 197 ms | 288 ms | 173 ms |
| document built | 175 ms | 172 ms | 197 ms | 288 ms | 173 ms |
| tokenizer attached to editor | 199 ms | 199 ms | 225 ms | 318 ms | — |
| tabs opened | 180 ms | 179 ms | 208 ms | 299 ms | 195 ms |
| built-in extensions registered | 346 ms | 350 ms | 374 ms | 448 ms | 267 ms |
| frame with file text | 198 ms | 197 ms | 223 ms | 316 ms | 210 ms |
| frame with highlighting | 311 ms | 316 ms | 339 ms | 416 ms | — |
| extension host up | 603 ms | 650 ms | 723 ms | 1174 ms | 453 ms |
| startup complete | 335 ms | 338 ms | 362 ms | 437 ms | 251 ms |
| to text (black box) | 201 ms | 198 ms | 225 ms | 316 ms | 211 ms |
| to highlight (black box) | 312 ms | 316 ms | 339 ms | 416 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 2 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 37 ms | 15 ms | 11 ms | 12 ms | — | 7 ms | 5 ms |
| `medium` failed | 29 ms | 16 ms | 13 ms | 16 ms | — | 9 ms | 6 ms |
| `large` failed | 35 ms | 24 ms | 27 ms | 23 ms | — | 17 ms | 21 ms |
| `xlarge` failed | 28 ms | 52 ms | 26 ms | 31 ms | — | 17 ms | 72 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
