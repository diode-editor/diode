# File open benchmark

- Recorded: 2026-11-10T07:25:03.538Z, commit `d740e0e33f6e`, diode nightly-d740e0e
- Machine: INTEL(R) XEON(R) PLATINUM 8573C (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 66 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **156 ms** | 115 ms | 182 ms | 293 ms | 6 ms | 272 MB | 11 |
| `medium` | 126.7 KB | 2000 | **161 ms** | 120 ms | 186 ms | 300 ms | 9 ms | 288 MB | 11 |
| `large` | 1.3 MB | 20000 | **175 ms** | 134 ms | 200 ms | 317 ms | 13 ms | 298 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **261 ms** | 220 ms | 286 ms | 387 ms | 10 ms | 351 MB | 5 |
| `log500m` | 497 MB | 5295839 | **185 ms** | 144 ms | 211 ms | — (plaintext) | 1 ms | 307 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 6 ms | 7 ms | 7 ms | 6 ms |
| node ready (bootstrapComplete) | 71 ms | 70 ms | 73 ms | 77 ms | 70 ms |
| bundle executed (main:start) | 71 ms | 70 ms | 73 ms | 77 ms | 71 ms |
| config loaded | 89 ms | 90 ms | 92 ms | 93 ms | 92 ms |
| keybindings loaded | 90 ms | 92 ms | 92 ms | 93 ms | 92 ms |
| session state loaded | 91 ms | 92 ms | 93 ms | 93 ms | 92 ms |
| extensions scanned | 86 ms | 86 ms | 88 ms | 90 ms | 88 ms |
| themes ready | 95 ms | 96 ms | 98 ms | 98 ms | 97 ms |
| DI container created | 99 ms | 99 ms | 102 ms | 103 ms | 102 ms |
| workbench mounted | 141 ms | 138 ms | 142 ms | 150 ms | 148 ms |
| first frame | 141 ms | 138 ms | 142 ms | 150 ms | 148 ms |
| workbench activated | 151 ms | 146 ms | 155 ms | 157 ms | 156 ms |
| grammars preloaded | 158 ms | 154 ms | 161 ms | 163 ms | 159 ms |
| file read from disk | 161 ms | 157 ms | 174 ms | 261 ms | 173 ms |
| file decoded | 161 ms | 157 ms | 174 ms | 261 ms | 173 ms |
| document built | 162 ms | 158 ms | 174 ms | 261 ms | 173 ms |
| tokenizer attached to editor | 181 ms | 185 ms | 200 ms | 288 ms | — |
| tabs opened | 166 ms | 164 ms | 184 ms | 271 ms | 192 ms |
| built-in extensions registered | 317 ms | 325 ms | 339 ms | 410 ms | 251 ms |
| frame with file text | 180 ms | 182 ms | 199 ms | 285 ms | 210 ms |
| frame with highlighting | 293 ms | 300 ms | 317 ms | 387 ms | — |
| extension host up | 560 ms | 590 ms | 681 ms | 1105 ms | 458 ms |
| startup complete | 306 ms | 314 ms | 330 ms | 401 ms | 241 ms |
| to text (black box) | 182 ms | 186 ms | 200 ms | 286 ms | 211 ms |
| to highlight (black box) | 293 ms | 300 ms | 317 ms | 387 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 2 ms | 2 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 32 ms | 17 ms | 15 ms | 11 ms | — | 8 ms | 4 ms |
| `medium` failed | 34 ms | 20 ms | 13 ms | 10 ms | — | 6 ms | 7 ms |
| `large` failed | 39 ms | 34 ms | 25 ms | 18 ms | — | 19 ms | 17 ms |
| `xlarge` failed | 38 ms | 41 ms | 26 ms | 63 ms | — | 27 ms | 83 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
