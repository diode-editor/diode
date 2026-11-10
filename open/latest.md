# File open benchmark

- Recorded: 2026-11-10T08:11:41.140Z, commit `031425c82881`, diode nightly-031425c
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 24 ms; binary floor (`diode --version` over PTY, median): 65 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **169 ms** | 127 ms | 192 ms | 314 ms | 13 ms | 279 MB | 11 |
| `medium` | 126.7 KB | 2000 | **162 ms** | 121 ms | 186 ms | 301 ms | 10 ms | 288 MB | 11 |
| `large` | 1.3 MB | 20000 | **177 ms** | 136 ms | 201 ms | 316 ms | 6 ms | 298 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **262 ms** | 221 ms | 286 ms | 385 ms | 13 ms | 350 MB | 5 |
| `log500m` | 497 MB | 5295839 | **170 ms** | 129 ms | 194 ms | — (plaintext) | 2 ms | 309 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 8 ms | 10 ms | 6 ms |
| node ready (bootstrapComplete) | 74 ms | 70 ms | 75 ms | 88 ms | 65 ms |
| bundle executed (main:start) | 74 ms | 70 ms | 75 ms | 88 ms | 65 ms |
| config loaded | 95 ms | 90 ms | 96 ms | 107 ms | 82 ms |
| keybindings loaded | 95 ms | 90 ms | 96 ms | 107 ms | 83 ms |
| session state loaded | 96 ms | 90 ms | 96 ms | 107 ms | 83 ms |
| extensions scanned | 90 ms | 87 ms | 92 ms | 102 ms | 78 ms |
| themes ready | 99 ms | 94 ms | 102 ms | 112 ms | 87 ms |
| DI container created | 102 ms | 98 ms | 106 ms | 116 ms | 91 ms |
| workbench mounted | 150 ms | 145 ms | 144 ms | 164 ms | 139 ms |
| first frame | 150 ms | 145 ms | 144 ms | 164 ms | 139 ms |
| workbench activated | 157 ms | 152 ms | 151 ms | 170 ms | 146 ms |
| grammars preloaded | 163 ms | 157 ms | 157 ms | 175 ms | 149 ms |
| file read from disk | 166 ms | 162 ms | 172 ms | 261 ms | 161 ms |
| file decoded | 166 ms | 162 ms | 172 ms | 261 ms | 161 ms |
| document built | 166 ms | 162 ms | 173 ms | 261 ms | 161 ms |
| tokenizer attached to editor | 192 ms | 185 ms | 202 ms | 288 ms | — |
| tabs opened | 171 ms | 169 ms | 183 ms | 272 ms | 179 ms |
| built-in extensions registered | 341 ms | 327 ms | 342 ms | 411 ms | 239 ms |
| frame with file text | 191 ms | 183 ms | 200 ms | 286 ms | 192 ms |
| frame with highlighting | 314 ms | 301 ms | 316 ms | 385 ms | — |
| extension host up | 603 ms | 616 ms | 700 ms | 1113 ms | 439 ms |
| startup complete | 333 ms | 319 ms | 333 ms | 402 ms | 228 ms |
| to text (black box) | 192 ms | 186 ms | 201 ms | 286 ms | 194 ms |
| to highlight (black box) | 314 ms | 301 ms | 316 ms | 385 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 40 ms | 13 ms | 12 ms | 13 ms | — | 9 ms | 3 ms |
| `medium` failed | 34 ms | 17 ms | 11 ms | 11 ms | — | 8 ms | 6 ms |
| `large` failed | 32 ms | 23 ms | 20 ms | 22 ms | — | 23 ms | 15 ms |
| `xlarge` failed | 31 ms | 39 ms | 25 ms | 50 ms | — | 17 ms | 93 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
