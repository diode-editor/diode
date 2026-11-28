# File open benchmark

- Recorded: 2026-11-28T16:31:30.243Z, commit `819b0289d933`, diode nightly-819b028
- Machine: INTEL(R) XEON(R) PLATINUM 8573C (4 cores, 16 GB), linux 7.0.0-1020-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 22 ms; binary floor (`diode --version` over PTY, median): 68 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **153 ms** | 107 ms | 175 ms | 289 ms | 9 ms | 300 MB | 11 |
| `medium` | 126.7 KB | 2000 | **159 ms** | 113 ms | 181 ms | 289 ms | 4 ms | 304 MB | 11 |
| `large` | 1.3 MB | 20000 | **176 ms** | 130 ms | 198 ms | 305 ms | 8 ms | 319 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **262 ms** | 216 ms | 284 ms | 378 ms | 3 ms | 367 MB | 5 |
| `log500m` | 497 MB | 5295839 | **177 ms** | 132 ms | 199 ms | — (plaintext) | 8 ms | 331 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 6 ms | 7 ms | 4 ms |
| node ready (bootstrapComplete) | 70 ms | 70 ms | 72 ms | 76 ms | 70 ms |
| bundle executed (main:start) | 70 ms | 70 ms | 72 ms | 76 ms | 70 ms |
| config loaded | 91 ms | 92 ms | 92 ms | 100 ms | 90 ms |
| keybindings loaded | 91 ms | 95 ms | 94 ms | 101 ms | 92 ms |
| session state loaded | 91 ms | 95 ms | 94 ms | 102 ms | 93 ms |
| extensions scanned | 86 ms | 86 ms | 88 ms | 93 ms | 85 ms |
| themes ready | 96 ms | 98 ms | 98 ms | 105 ms | 96 ms |
| DI container created | 100 ms | 101 ms | 102 ms | 110 ms | 99 ms |
| workbench mounted | 140 ms | 143 ms | 149 ms | 148 ms | 148 ms |
| first frame | 140 ms | 143 ms | 149 ms | 148 ms | 148 ms |
| workbench activated | 147 ms | 149 ms | 155 ms | 154 ms | 155 ms |
| grammars preloaded | 152 ms | 155 ms | 161 ms | 161 ms | 157 ms |
| file read from disk | 154 ms | 158 ms | 174 ms | 256 ms | 168 ms |
| file decoded | 154 ms | 158 ms | 174 ms | 256 ms | 168 ms |
| document built | 154 ms | 159 ms | 174 ms | 256 ms | 168 ms |
| tokenizer attached to editor | 173 ms | 180 ms | 197 ms | 285 ms | — |
| tabs opened | 158 ms | 164 ms | 182 ms | 266 ms | 185 ms |
| built-in extensions registered | 319 ms | 320 ms | 334 ms | 404 ms | 242 ms |
| frame with file text | 172 ms | 178 ms | 195 ms | 282 ms | 197 ms |
| frame with highlighting | 288 ms | 289 ms | 305 ms | 378 ms | — |
| extension host up | 534 ms | 580 ms | 632 ms | 1061 ms | 432 ms |
| startup complete | 305 ms | 307 ms | 321 ms | 393 ms | 229 ms |
| to text (black box) | 175 ms | 181 ms | 198 ms | 284 ms | 199 ms |
| to highlight (black box) | 289 ms | 289 ms | 305 ms | 378 ms | — |
| gap black − white (text) | 2 ms | 3 ms | 2 ms | 0 ms | 3 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 34 ms | 14 ms | 12 ms | 9 ms | — | 6 ms | 4 ms |
| `medium` failed | 33 ms | 15 ms | 11 ms | 11 ms | — | 6 ms | 6 ms |
| `large` failed | 43 ms | 20 ms | 26 ms | 20 ms | — | 15 ms | 18 ms |
| `xlarge` failed | 42 ms | 33 ms | 14 ms | 19 ms | — | 13 ms | 90 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
