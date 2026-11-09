# File open benchmark

- Recorded: 2026-11-09T02:32:35.960Z, commit `f2602d2dabde`, diode nightly-f2602d2
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 24 ms; binary floor (`diode --version` over PTY, median): 68 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **163 ms** | 120 ms | 188 ms | 304 ms | 6 ms | 262 MB | 11 |
| `medium` | 126.7 KB | 2000 | **169 ms** | 126 ms | 194 ms | 311 ms | 7 ms | 289 MB | 11 |
| `large` | 1.3 MB | 20000 | **181 ms** | 137 ms | 205 ms | 320 ms | 12 ms | 299 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **287 ms** | 244 ms | 312 ms | 412 ms | 23 ms | 353 MB | 5 |
| `log500m` | 497 MB | 5295839 | **182 ms** | 138 ms | 206 ms | — (plaintext) | 5 ms | 306 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 7 ms | 10 ms | 6 ms |
| node ready (bootstrapComplete) | 72 ms | 72 ms | 78 ms | 92 ms | 69 ms |
| bundle executed (main:start) | 72 ms | 73 ms | 78 ms | 92 ms | 69 ms |
| config loaded | 92 ms | 91 ms | 101 ms | 117 ms | 95 ms |
| keybindings loaded | 92 ms | 92 ms | 102 ms | 117 ms | 95 ms |
| session state loaded | 92 ms | 92 ms | 102 ms | 117 ms | 95 ms |
| extensions scanned | 87 ms | 87 ms | 96 ms | 112 ms | 85 ms |
| themes ready | 98 ms | 98 ms | 107 ms | 121 ms | 99 ms |
| DI container created | 103 ms | 102 ms | 110 ms | 124 ms | 102 ms |
| workbench mounted | 150 ms | 149 ms | 148 ms | 162 ms | 139 ms |
| first frame | 149 ms | 149 ms | 148 ms | 162 ms | 139 ms |
| workbench activated | 158 ms | 157 ms | 156 ms | 169 ms | 146 ms |
| grammars preloaded | 164 ms | 163 ms | 162 ms | 176 ms | 149 ms |
| file read from disk | 166 ms | 167 ms | 174 ms | 285 ms | 163 ms |
| file decoded | 166 ms | 167 ms | 174 ms | 285 ms | 163 ms |
| document built | 167 ms | 168 ms | 174 ms | 286 ms | 164 ms |
| tokenizer attached to editor | 188 ms | 195 ms | 206 ms | 314 ms | — |
| tabs opened | 171 ms | 175 ms | 184 ms | 297 ms | 186 ms |
| built-in extensions registered | 335 ms | 342 ms | 350 ms | 441 ms | 251 ms |
| frame with file text | 187 ms | 194 ms | 204 ms | 312 ms | 204 ms |
| frame with highlighting | 304 ms | 311 ms | 320 ms | 412 ms | — |
| extension host up | 587 ms | 633 ms | 693 ms | 1166 ms | 466 ms |
| startup complete | 326 ms | 333 ms | 340 ms | 432 ms | 240 ms |
| to text (black box) | 188 ms | 194 ms | 205 ms | 312 ms | 206 ms |
| to highlight (black box) | 304 ms | 311 ms | 320 ms | 412 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 2 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 39 ms | 15 ms | 14 ms | 13 ms | — | 9 ms | 6 ms |
| `medium` failed | 26 ms | 16 ms | 9 ms | 9 ms | — | 7 ms | 8 ms |
| `large` failed | 37 ms | 19 ms | 18 ms | 21 ms | — | 24 ms | 17 ms |
| `xlarge` failed | 30 ms | 44 ms | 31 ms | 54 ms | — | 22 ms | 78 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
