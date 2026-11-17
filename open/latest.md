# File open benchmark

- Recorded: 2026-11-17T15:01:43.355Z, commit `c98484f09012`, diode nightly-c98484f
- Machine: INTEL(R) XEON(R) PLATINUM 8573C (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 68 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **158 ms** | 115 ms | 183 ms | 298 ms | 22 ms | 285 MB | 11 |
| `medium` | 126.7 KB | 2000 | **160 ms** | 117 ms | 185 ms | 295 ms | 8 ms | 295 MB | 11 |
| `large` | 1.3 MB | 20000 | **174 ms** | 130 ms | 198 ms | 315 ms | 16 ms | 305 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **254 ms** | 210 ms | 279 ms | 374 ms | 9 ms | 360 MB | 5 |
| `log500m` | 497 MB | 5295839 | **170 ms** | 126 ms | 195 ms | — (plaintext) | 12 ms | 310 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 7 ms | 6 ms | 7 ms | 5 ms |
| node ready (bootstrapComplete) | 73 ms | 71 ms | 72 ms | 80 ms | 68 ms |
| bundle executed (main:start) | 73 ms | 71 ms | 72 ms | 80 ms | 68 ms |
| config loaded | 97 ms | 92 ms | 92 ms | 97 ms | 91 ms |
| keybindings loaded | 97 ms | 93 ms | 92 ms | 100 ms | 91 ms |
| session state loaded | 97 ms | 93 ms | 93 ms | 100 ms | 91 ms |
| extensions scanned | 93 ms | 85 ms | 87 ms | 93 ms | 87 ms |
| themes ready | 100 ms | 97 ms | 98 ms | 104 ms | 95 ms |
| DI container created | 104 ms | 101 ms | 102 ms | 107 ms | 98 ms |
| workbench mounted | 148 ms | 145 ms | 147 ms | 149 ms | 136 ms |
| first frame | 148 ms | 145 ms | 147 ms | 149 ms | 136 ms |
| workbench activated | 156 ms | 153 ms | 153 ms | 157 ms | 149 ms |
| grammars preloaded | 162 ms | 158 ms | 159 ms | 161 ms | 151 ms |
| file read from disk | 164 ms | 162 ms | 171 ms | 251 ms | 162 ms |
| file decoded | 164 ms | 162 ms | 171 ms | 251 ms | 162 ms |
| document built | 165 ms | 162 ms | 172 ms | 252 ms | 162 ms |
| tokenizer attached to editor | 183 ms | 185 ms | 198 ms | 279 ms | — |
| tabs opened | 169 ms | 169 ms | 182 ms | 262 ms | 179 ms |
| built-in extensions registered | 324 ms | 317 ms | 339 ms | 398 ms | 229 ms |
| frame with file text | 182 ms | 183 ms | 196 ms | 277 ms | 193 ms |
| frame with highlighting | 297 ms | 294 ms | 315 ms | 374 ms | — |
| extension host up | 549 ms | 577 ms | 666 ms | 1085 ms | 414 ms |
| startup complete | 314 ms | 307 ms | 330 ms | 388 ms | 219 ms |
| to text (black box) | 183 ms | 185 ms | 198 ms | 279 ms | 195 ms |
| to highlight (black box) | 298 ms | 295 ms | 315 ms | 374 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 2 ms | 2 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 37 ms | 18 ms | 10 ms | 9 ms | — | 6 ms | 4 ms |
| `medium` failed | 29 ms | 16 ms | 11 ms | 9 ms | — | 8 ms | 7 ms |
| `large` failed | 40 ms | 26 ms | 19 ms | 26 ms | — | 15 ms | 17 ms |
| `xlarge` failed | 28 ms | 37 ms | 28 ms | 20 ms | — | 13 ms | 81 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
