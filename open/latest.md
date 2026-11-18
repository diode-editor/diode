# File open benchmark

- Recorded: 2026-11-18T04:18:26.770Z, commit `ab62ba9fd432`, diode nightly-ab62ba9
- Machine: INTEL(R) XEON(R) PLATINUM 8573C (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 23 ms; binary floor (`diode --version` over PTY, median): 69 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **161 ms** | 115 ms | 184 ms | 296 ms | 4 ms | 281 MB | 11 |
| `medium` | 126.7 KB | 2000 | **163 ms** | 116 ms | 186 ms | 294 ms | 16 ms | 295 MB | 11 |
| `large` | 1.3 MB | 20000 | **175 ms** | 129 ms | 198 ms | 312 ms | 8 ms | 307 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **263 ms** | 217 ms | 286 ms | 380 ms | 3 ms | 360 MB | 5 |
| `log500m` | 497 MB | 5295839 | **178 ms** | 131 ms | 200 ms | — (plaintext) | 3 ms | 313 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 6 ms | 8 ms | 5 ms |
| node ready (bootstrapComplete) | 73 ms | 72 ms | 71 ms | 81 ms | 69 ms |
| bundle executed (main:start) | 73 ms | 72 ms | 71 ms | 81 ms | 69 ms |
| config loaded | 93 ms | 94 ms | 97 ms | 102 ms | 87 ms |
| keybindings loaded | 95 ms | 94 ms | 97 ms | 102 ms | 88 ms |
| session state loaded | 96 ms | 94 ms | 98 ms | 102 ms | 88 ms |
| extensions scanned | 88 ms | 87 ms | 90 ms | 96 ms | 83 ms |
| themes ready | 99 ms | 98 ms | 101 ms | 106 ms | 92 ms |
| DI container created | 102 ms | 101 ms | 104 ms | 110 ms | 96 ms |
| workbench mounted | 145 ms | 145 ms | 146 ms | 154 ms | 151 ms |
| first frame | 144 ms | 145 ms | 146 ms | 154 ms | 151 ms |
| workbench activated | 155 ms | 154 ms | 154 ms | 162 ms | 158 ms |
| grammars preloaded | 161 ms | 160 ms | 159 ms | 167 ms | 160 ms |
| file read from disk | 163 ms | 163 ms | 172 ms | 261 ms | 170 ms |
| file decoded | 163 ms | 163 ms | 172 ms | 261 ms | 170 ms |
| document built | 164 ms | 164 ms | 172 ms | 261 ms | 170 ms |
| tokenizer attached to editor | 182 ms | 185 ms | 199 ms | 287 ms | — |
| tabs opened | 168 ms | 171 ms | 181 ms | 270 ms | 187 ms |
| built-in extensions registered | 322 ms | 322 ms | 339 ms | 404 ms | 242 ms |
| frame with file text | 181 ms | 184 ms | 197 ms | 285 ms | 200 ms |
| frame with highlighting | 295 ms | 294 ms | 312 ms | 380 ms | — |
| extension host up | 553 ms | 588 ms | 677 ms | 1099 ms | 435 ms |
| startup complete | 310 ms | 308 ms | 326 ms | 394 ms | 231 ms |
| to text (black box) | 184 ms | 186 ms | 198 ms | 286 ms | 200 ms |
| to highlight (black box) | 296 ms | 294 ms | 312 ms | 380 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 1 ms | 2 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 33 ms | 13 ms | 9 ms | 12 ms | — | 7 ms | 4 ms |
| `medium` failed | 32 ms | 14 ms | 12 ms | 11 ms | — | 5 ms | 7 ms |
| `large` failed | 34 ms | 20 ms | 22 ms | 25 ms | — | 13 ms | 15 ms |
| `xlarge` failed | 30 ms | 36 ms | 22 ms | 25 ms | — | 15 ms | 81 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
