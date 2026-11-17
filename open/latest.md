# File open benchmark

- Recorded: 2026-11-17T09:25:54.553Z, commit `f71b0272e483`, diode nightly-f71b027
- Machine: INTEL(R) XEON(R) PLATINUM 8573C (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 70 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **161 ms** | 116 ms | 186 ms | 305 ms | 4 ms | 277 MB | 11 |
| `medium` | 126.7 KB | 2000 | **166 ms** | 121 ms | 191 ms | 307 ms | 9 ms | 293 MB | 11 |
| `large` | 1.3 MB | 20000 | **185 ms** | 140 ms | 210 ms | 323 ms | 3 ms | 305 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **277 ms** | 231 ms | 301 ms | 402 ms | 5 ms | 354 MB | 5 |
| `log500m` | 497 MB | 5295839 | **183 ms** | 138 ms | 208 ms | — (plaintext) | 6 ms | 314 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 7 ms | 8 ms | 6 ms |
| node ready (bootstrapComplete) | 74 ms | 75 ms | 77 ms | 87 ms | 73 ms |
| bundle executed (main:start) | 74 ms | 75 ms | 77 ms | 87 ms | 73 ms |
| config loaded | 93 ms | 95 ms | 97 ms | 105 ms | 96 ms |
| keybindings loaded | 93 ms | 95 ms | 97 ms | 106 ms | 97 ms |
| session state loaded | 93 ms | 95 ms | 98 ms | 106 ms | 98 ms |
| extensions scanned | 87 ms | 90 ms | 89 ms | 100 ms | 91 ms |
| themes ready | 98 ms | 100 ms | 103 ms | 111 ms | 103 ms |
| DI container created | 102 ms | 105 ms | 107 ms | 116 ms | 107 ms |
| workbench mounted | 149 ms | 148 ms | 154 ms | 166 ms | 145 ms |
| first frame | 149 ms | 148 ms | 154 ms | 166 ms | 145 ms |
| workbench activated | 156 ms | 156 ms | 162 ms | 173 ms | 154 ms |
| grammars preloaded | 162 ms | 161 ms | 167 ms | 179 ms | 156 ms |
| file read from disk | 166 ms | 166 ms | 182 ms | 272 ms | 167 ms |
| file decoded | 166 ms | 166 ms | 182 ms | 272 ms | 167 ms |
| document built | 166 ms | 166 ms | 182 ms | 273 ms | 167 ms |
| tokenizer attached to editor | 186 ms | 189 ms | 209 ms | 300 ms | — |
| tabs opened | 170 ms | 172 ms | 191 ms | 282 ms | 188 ms |
| built-in extensions registered | 329 ms | 331 ms | 349 ms | 425 ms | 248 ms |
| frame with file text | 185 ms | 187 ms | 207 ms | 298 ms | 208 ms |
| frame with highlighting | 305 ms | 306 ms | 321 ms | 402 ms | — |
| extension host up | 555 ms | 592 ms | 698 ms | 1132 ms | 450 ms |
| startup complete | 318 ms | 321 ms | 339 ms | 416 ms | 237 ms |
| to text (black box) | 186 ms | 191 ms | 210 ms | 301 ms | 208 ms |
| to highlight (black box) | 305 ms | 307 ms | 323 ms | 402 ms | — |
| gap black − white (text) | 2 ms | 1 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 34 ms | 14 ms | 13 ms | 12 ms | — | 8 ms | 4 ms |
| `medium` failed | 40 ms | 14 ms | 12 ms | 12 ms | — | 12 ms | 7 ms |
| `large` failed | 32 ms | 25 ms | 23 ms | 22 ms | — | 32 ms | 17 ms |
| `xlarge` failed | 41 ms | 37 ms | 29 ms | 25 ms | — | 15 ms | 81 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
