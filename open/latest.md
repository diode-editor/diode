# File open benchmark

- Recorded: 2026-11-15T12:15:56.154Z, commit `842c81e39bbe`, diode nightly-842c81e
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 70 ms; for reference `node --version`: 5 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **174 ms** | 129 ms | 199 ms | 311 ms | 17 ms | 283 MB | 11 |
| `medium` | 126.7 KB | 2000 | **170 ms** | 125 ms | 195 ms | 308 ms | 4 ms | 288 MB | 11 |
| `large` | 1.3 MB | 20000 | **184 ms** | 139 ms | 209 ms | 322 ms | 7 ms | 301 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **262 ms** | 217 ms | 287 ms | 386 ms | 20 ms | 354 MB | 5 |
| `log500m` | 497 MB | 5295839 | **183 ms** | 139 ms | 209 ms | — (plaintext) | 2 ms | 311 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 7 ms | 12 ms | 6 ms |
| node ready (bootstrapComplete) | 76 ms | 74 ms | 74 ms | 86 ms | 69 ms |
| bundle executed (main:start) | 76 ms | 74 ms | 74 ms | 86 ms | 69 ms |
| config loaded | 101 ms | 95 ms | 95 ms | 112 ms | 89 ms |
| keybindings loaded | 101 ms | 95 ms | 96 ms | 112 ms | 89 ms |
| session state loaded | 101 ms | 95 ms | 96 ms | 113 ms | 89 ms |
| extensions scanned | 91 ms | 90 ms | 91 ms | 102 ms | 83 ms |
| themes ready | 105 ms | 101 ms | 101 ms | 116 ms | 94 ms |
| DI container created | 109 ms | 105 ms | 106 ms | 119 ms | 99 ms |
| workbench mounted | 155 ms | 152 ms | 152 ms | 160 ms | 146 ms |
| first frame | 155 ms | 152 ms | 152 ms | 159 ms | 146 ms |
| workbench activated | 162 ms | 158 ms | 160 ms | 167 ms | 153 ms |
| grammars preloaded | 167 ms | 164 ms | 166 ms | 173 ms | 156 ms |
| file read from disk | 171 ms | 169 ms | 182 ms | 259 ms | 168 ms |
| file decoded | 171 ms | 169 ms | 182 ms | 259 ms | 168 ms |
| document built | 171 ms | 169 ms | 182 ms | 259 ms | 168 ms |
| tokenizer attached to editor | 197 ms | 196 ms | 210 ms | 287 ms | — |
| tabs opened | 176 ms | 176 ms | 191 ms | 270 ms | 191 ms |
| built-in extensions registered | 340 ms | 338 ms | 350 ms | 414 ms | 253 ms |
| frame with file text | 196 ms | 193 ms | 208 ms | 285 ms | 208 ms |
| frame with highlighting | 311 ms | 308 ms | 322 ms | 386 ms | — |
| extension host up | 606 ms | 635 ms | 697 ms | 1143 ms | 466 ms |
| startup complete | 330 ms | 327 ms | 341 ms | 405 ms | 241 ms |
| to text (black box) | 199 ms | 195 ms | 209 ms | 287 ms | 209 ms |
| to highlight (black box) | 311 ms | 308 ms | 322 ms | 386 ms | — |
| gap black − white (text) | 2 ms | 1 ms | 1 ms | 2 ms | 2 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 33 ms | 17 ms | 16 ms | 16 ms | — | 9 ms | 4 ms |
| `medium` failed | 33 ms | 15 ms | 10 ms | 9 ms | — | 7 ms | 7 ms |
| `large` failed | 41 ms | 24 ms | 23 ms | 23 ms | — | 15 ms | 23 ms |
| `xlarge` failed | 34 ms | 37 ms | 25 ms | 27 ms | — | 25 ms | 83 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
