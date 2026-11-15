# File open benchmark

- Recorded: 2026-11-15T06:09:14.879Z, commit `97d96304affe`, diode nightly-97d9630
- Machine: Intel(R) Xeon(R) 6975P-C (4 cores, 15 GB), linux 7.0.0-1016-aws
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 16 ms; binary floor (`diode --version` over PTY, median): 50 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **115 ms** | 82 ms | 132 ms | 214 ms | 3 ms | 272 MB | 11 |
| `medium` | 126.7 KB | 2000 | **117 ms** | 83 ms | 133 ms | 216 ms | 6 ms | 290 MB | 11 |
| `large` | 1.3 MB | 20000 | **124 ms** | 91 ms | 141 ms | 223 ms | 3 ms | 306 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **189 ms** | 155 ms | 205 ms | 276 ms | 7 ms | 361 MB | 5 |
| `log500m` | 497 MB | 5295839 | **127 ms** | 94 ms | 144 ms | — (plaintext) | 2 ms | 281 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 4 ms | 4 ms | 4 ms | 6 ms | 4 ms |
| node ready (bootstrapComplete) | 54 ms | 53 ms | 52 ms | 59 ms | 51 ms |
| bundle executed (main:start) | 54 ms | 53 ms | 52 ms | 59 ms | 51 ms |
| config loaded | 66 ms | 67 ms | 64 ms | 73 ms | 65 ms |
| keybindings loaded | 66 ms | 68 ms | 64 ms | 75 ms | 65 ms |
| session state loaded | 66 ms | 68 ms | 64 ms | 75 ms | 65 ms |
| extensions scanned | 63 ms | 64 ms | 62 ms | 70 ms | 62 ms |
| themes ready | 70 ms | 72 ms | 68 ms | 77 ms | 69 ms |
| DI container created | 73 ms | 75 ms | 71 ms | 80 ms | 72 ms |
| workbench mounted | 101 ms | 101 ms | 99 ms | 108 ms | 101 ms |
| first frame | 101 ms | 101 ms | 99 ms | 108 ms | 101 ms |
| workbench activated | 106 ms | 107 ms | 105 ms | 114 ms | 107 ms |
| grammars preloaded | 114 ms | 115 ms | 113 ms | 122 ms | 113 ms |
| file read from disk | 116 ms | 117 ms | 124 ms | 186 ms | 121 ms |
| file decoded | 116 ms | 117 ms | 124 ms | 186 ms | 121 ms |
| document built | 116 ms | 117 ms | 124 ms | 186 ms | 121 ms |
| tokenizer attached to editor | 130 ms | 135 ms | 141 ms | 205 ms | — |
| tabs opened | 119 ms | 121 ms | 130 ms | 193 ms | 133 ms |
| built-in extensions registered | 230 ms | 233 ms | 239 ms | 291 ms | 172 ms |
| frame with file text | 130 ms | 133 ms | 140 ms | 204 ms | 143 ms |
| frame with highlighting | 214 ms | 216 ms | 222 ms | 276 ms | — |
| extension host up | 395 ms | 417 ms | 469 ms | 852 ms | 311 ms |
| startup complete | 223 ms | 225 ms | 233 ms | 285 ms | 164 ms |
| to text (black box) | 132 ms | 133 ms | 141 ms | 205 ms | 144 ms |
| to highlight (black box) | 214 ms | 216 ms | 223 ms | 276 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 1 ms | 2 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 12 ms | 7 ms | 7 ms | 7 ms | — | 4 ms | 2 ms |
| `medium` failed | 23 ms | 11 ms | 7 ms | 6 ms | — | 3 ms | 4 ms |
| `large` failed | 32 ms | 19 ms | 22 ms | 11 ms | — | 12 ms | 13 ms |
| `xlarge` failed | 28 ms | 30 ms | 20 ms | 27 ms | — | 27 ms | 52 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
