# File open benchmark

- Recorded: 2026-11-10T08:15:28.482Z, commit `8bdeac2bdf55`, diode nightly-8bdeac2
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 68 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **171 ms** | 128 ms | 196 ms | 317 ms | 12 ms | 272 MB | 11 |
| `medium` | 126.7 KB | 2000 | **170 ms** | 127 ms | 195 ms | 315 ms | 10 ms | 288 MB | 11 |
| `large` | 1.3 MB | 20000 | **187 ms** | 144 ms | 212 ms | 332 ms | 5 ms | 297 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **277 ms** | 234 ms | 302 ms | 401 ms | 9 ms | 350 MB | 5 |
| `log500m` | 497 MB | 5295839 | **186 ms** | 143 ms | 211 ms | — (plaintext) | 5 ms | 307 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 8 ms | 9 ms | 6 ms |
| node ready (bootstrapComplete) | 75 ms | 73 ms | 80 ms | 91 ms | 69 ms |
| bundle executed (main:start) | 75 ms | 73 ms | 80 ms | 91 ms | 69 ms |
| config loaded | 98 ms | 96 ms | 106 ms | 113 ms | 93 ms |
| keybindings loaded | 100 ms | 96 ms | 106 ms | 113 ms | 93 ms |
| session state loaded | 100 ms | 96 ms | 107 ms | 113 ms | 93 ms |
| extensions scanned | 92 ms | 89 ms | 97 ms | 108 ms | 86 ms |
| themes ready | 104 ms | 100 ms | 110 ms | 118 ms | 97 ms |
| DI container created | 108 ms | 103 ms | 114 ms | 123 ms | 102 ms |
| workbench mounted | 152 ms | 146 ms | 155 ms | 166 ms | 149 ms |
| first frame | 152 ms | 146 ms | 155 ms | 166 ms | 149 ms |
| workbench activated | 160 ms | 155 ms | 163 ms | 175 ms | 156 ms |
| grammars preloaded | 166 ms | 162 ms | 168 ms | 180 ms | 159 ms |
| file read from disk | 169 ms | 166 ms | 184 ms | 273 ms | 171 ms |
| file decoded | 169 ms | 166 ms | 184 ms | 273 ms | 171 ms |
| document built | 170 ms | 166 ms | 184 ms | 273 ms | 171 ms |
| tokenizer attached to editor | 195 ms | 195 ms | 214 ms | 303 ms | — |
| tabs opened | 174 ms | 173 ms | 195 ms | 283 ms | 191 ms |
| built-in extensions registered | 348 ms | 348 ms | 365 ms | 435 ms | 259 ms |
| frame with file text | 194 ms | 193 ms | 212 ms | 301 ms | 211 ms |
| frame with highlighting | 316 ms | 315 ms | 332 ms | 401 ms | — |
| extension host up | 621 ms | 654 ms | 726 ms | 1146 ms | 478 ms |
| startup complete | 339 ms | 338 ms | 354 ms | 423 ms | 248 ms |
| to text (black box) | 196 ms | 195 ms | 212 ms | 302 ms | 211 ms |
| to highlight (black box) | 317 ms | 315 ms | 332 ms | 401 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 2 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 39 ms | 16 ms | 12 ms | 10 ms | — | 8 ms | 5 ms |
| `medium` failed | 37 ms | 15 ms | 11 ms | 11 ms | — | 7 ms | 5 ms |
| `large` failed | 30 ms | 30 ms | 25 ms | 16 ms | — | 15 ms | 22 ms |
| `xlarge` failed | 35 ms | 29 ms | 17 ms | 36 ms | — | 21 ms | 78 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
