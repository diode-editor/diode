# File open benchmark

- Recorded: 2026-11-01T13:10:10.521Z, commit `fec4005352c3`, diode nightly-fec4005
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 62 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **144 ms** | 107 ms | 168 ms | 284 ms | 9 ms | 271 MB | 11 |
| `medium` | 126.7 KB | 2000 | **147 ms** | 110 ms | 172 ms | 289 ms | 6 ms | 282 MB | 11 |
| `large` | 1.3 MB | 20000 | **169 ms** | 132 ms | 194 ms | 331 ms | 7 ms | 292 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **250 ms** | 213 ms | 275 ms | 401 ms | 7 ms | 365 MB | 5 |
| `log500m` | 497 MB | 5295839 | **163 ms** | 126 ms | 188 ms | — (plaintext) | 5 ms | 272 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 8 ms | 11 ms | 6 ms |
| node ready (bootstrapComplete) | 68 ms | 67 ms | 71 ms | 77 ms | 64 ms |
| bundle executed (main:start) | 68 ms | 68 ms | 71 ms | 77 ms | 64 ms |
| config loaded | 88 ms | 86 ms | 91 ms | 101 ms | 83 ms |
| keybindings loaded | 88 ms | 88 ms | 92 ms | 101 ms | 83 ms |
| session state loaded | 89 ms | 88 ms | 92 ms | 101 ms | 83 ms |
| extensions scanned | 83 ms | 83 ms | 86 ms | 98 ms | 79 ms |
| themes ready | 93 ms | 92 ms | 98 ms | 104 ms | 88 ms |
| DI container created | 96 ms | 95 ms | 102 ms | 108 ms | 92 ms |
| workbench mounted | 129 ms | 130 ms | 138 ms | 141 ms | 128 ms |
| first frame | 129 ms | 130 ms | 138 ms | 141 ms | 128 ms |
| workbench activated | 138 ms | 139 ms | 147 ms | 151 ms | 139 ms |
| grammars preloaded | 144 ms | 145 ms | 151 ms | 156 ms | 142 ms |
| file read from disk | 147 ms | 150 ms | 166 ms | 250 ms | 153 ms |
| file decoded | 147 ms | 150 ms | 166 ms | 251 ms | 153 ms |
| document built | 147 ms | 150 ms | 167 ms | 251 ms | 153 ms |
| tokenizer attached to editor | 170 ms | 178 ms | 209 ms | 292 ms | — |
| tabs opened | 152 ms | 156 ms | 176 ms | 261 ms | 173 ms |
| built-in extensions registered | 309 ms | 315 ms | 353 ms | 423 ms | 229 ms |
| frame with file text | 168 ms | 171 ms | 192 ms | 275 ms | 188 ms |
| frame with highlighting | 284 ms | 289 ms | 331 ms | 401 ms | — |
| extension host up | 554 ms | 590 ms | 671 ms | 1093 ms | 413 ms |
| startup complete | 303 ms | 309 ms | 348 ms | 417 ms | 221 ms |
| to text (black box) | 168 ms | 172 ms | 194 ms | 275 ms | 188 ms |
| to highlight (black box) | 284 ms | 289 ms | 331 ms | 401 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 36 ms | 14 ms | 12 ms | 11 ms | 22 ms | 7 ms | 3 ms |
| `medium` | 33 ms | 12 ms | 10 ms | 8 ms | 18 ms | 7 ms | 6 ms |
| `large` | 34 ms | 25 ms | 28 ms | 26 ms | 43 ms | 15 ms | 20 ms |
| `xlarge` | 38 ms | 39 ms | 23 ms | 25 ms | 120 ms | 16 ms | 80 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
