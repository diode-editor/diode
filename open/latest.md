# File open benchmark

- Recorded: 2026-11-16T17:15:51.782Z, commit `d603fba8a4ed`, diode nightly-d603fba
- Machine: Intel(R) Xeon(R) Platinum 8370C CPU @ 2.80GHz (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 22 ms; binary floor (`diode --version` over PTY, median): 66 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **155 ms** | 111 ms | 177 ms | 293 ms | 17 ms | 283 MB | 11 |
| `medium` | 126.7 KB | 2000 | **162 ms** | 118 ms | 183 ms | 298 ms | 7 ms | 290 MB | 11 |
| `large` | 1.3 MB | 20000 | **173 ms** | 129 ms | 195 ms | 312 ms | 22 ms | 304 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **248 ms** | 204 ms | 269 ms | 367 ms | 7 ms | 358 MB | 5 |
| `log500m` | 497 MB | 5295839 | **172 ms** | 127 ms | 193 ms | — (plaintext) | 8 ms | 315 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 9 ms | 7 ms | 5 ms |
| node ready (bootstrapComplete) | 69 ms | 70 ms | 74 ms | 75 ms | 68 ms |
| bundle executed (main:start) | 69 ms | 70 ms | 74 ms | 75 ms | 68 ms |
| config loaded | 90 ms | 90 ms | 96 ms | 100 ms | 87 ms |
| keybindings loaded | 91 ms | 90 ms | 96 ms | 100 ms | 89 ms |
| session state loaded | 91 ms | 90 ms | 96 ms | 100 ms | 89 ms |
| extensions scanned | 85 ms | 84 ms | 86 ms | 97 ms | 82 ms |
| themes ready | 97 ms | 95 ms | 99 ms | 104 ms | 93 ms |
| DI container created | 101 ms | 99 ms | 103 ms | 107 ms | 97 ms |
| workbench mounted | 143 ms | 140 ms | 144 ms | 141 ms | 140 ms |
| first frame | 143 ms | 140 ms | 144 ms | 141 ms | 140 ms |
| workbench activated | 150 ms | 150 ms | 151 ms | 148 ms | 148 ms |
| grammars preloaded | 155 ms | 156 ms | 156 ms | 153 ms | 150 ms |
| file read from disk | 157 ms | 160 ms | 168 ms | 244 ms | 161 ms |
| file decoded | 157 ms | 160 ms | 168 ms | 244 ms | 161 ms |
| document built | 158 ms | 160 ms | 168 ms | 244 ms | 161 ms |
| tokenizer attached to editor | 176 ms | 183 ms | 194 ms | 271 ms | — |
| tabs opened | 161 ms | 167 ms | 178 ms | 254 ms | 179 ms |
| built-in extensions registered | 317 ms | 323 ms | 335 ms | 390 ms | 236 ms |
| frame with file text | 175 ms | 182 ms | 191 ms | 269 ms | 193 ms |
| frame with highlighting | 293 ms | 299 ms | 312 ms | 367 ms | — |
| extension host up | 550 ms | 579 ms | 683 ms | 1083 ms | 432 ms |
| startup complete | 307 ms | 314 ms | 325 ms | 380 ms | 227 ms |
| to text (black box) | 177 ms | 183 ms | 195 ms | 269 ms | 193 ms |
| to highlight (black box) | 293 ms | 298 ms | 312 ms | 367 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 1 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 36 ms | 14 ms | 11 ms | 12 ms | — | 8 ms | 4 ms |
| `medium` failed | 29 ms | 16 ms | 13 ms | 9 ms | — | 8 ms | 8 ms |
| `large` failed | 32 ms | 24 ms | 19 ms | 26 ms | — | 17 ms | 20 ms |
| `xlarge` failed | 26 ms | 24 ms | 17 ms | 16 ms | — | 15 ms | 85 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
