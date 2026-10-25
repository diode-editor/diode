# File open benchmark

- Recorded: 2026-10-25T11:09:57.863Z, commit `2e033e3a1527`, diode nightly-2e033e3
- Machine: Intel(R) Xeon(R) 6973P-C (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 21 ms; binary floor (`diode --version` over PTY, median): 47 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **97 ms** | 71 ms | 118 ms | 208 ms | 17 ms | 244 MB | 11 |
| `medium` | 126.7 KB | 2000 | **97 ms** | 71 ms | 118 ms | 200 ms | 3 ms | 247 MB | 11 |
| `large` | 1.3 MB | 20000 | **107 ms** | 81 ms | 128 ms | 211 ms | 5 ms | 291 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **166 ms** | 140 ms | 187 ms | 255 ms | 7 ms | 356 MB | 5 |
| `log500m` | 497 MB | 5295839 | **117 ms** | 91 ms | 137 ms | — (plaintext) | 3 ms | 261 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 5 ms | 6 ms | 6 ms | 5 ms |
| node ready (bootstrapComplete) | 47 ms | 49 ms | 50 ms | 56 ms | 53 ms |
| bundle executed (main:start) | 47 ms | 49 ms | 51 ms | 56 ms | 53 ms |
| config loaded | 64 ms | 61 ms | 61 ms | 69 ms | 66 ms |
| keybindings loaded | 64 ms | 62 ms | 61 ms | 69 ms | 67 ms |
| session state loaded | 64 ms | 62 ms | 61 ms | 69 ms | 67 ms |
| extensions scanned | 61 ms | 59 ms | 58 ms | 67 ms | 64 ms |
| themes ready | 67 ms | 65 ms | 64 ms | 72 ms | 70 ms |
| DI container created | 70 ms | 68 ms | 67 ms | 75 ms | 74 ms |
| workbench mounted | 88 ms | 89 ms | 90 ms | 96 ms | 98 ms |
| first frame | 88 ms | 89 ms | 90 ms | 96 ms | 98 ms |
| workbench activated | 92 ms | 92 ms | 94 ms | 99 ms | 102 ms |
| grammars preloaded | 102 ms | 100 ms | 102 ms | 107 ms | 108 ms |
| file read from disk | 104 ms | 102 ms | 111 ms | 168 ms | 115 ms |
| file decoded | 104 ms | 102 ms | 111 ms | 168 ms | 115 ms |
| document built | 104 ms | 103 ms | 111 ms | 168 ms | 115 ms |
| tokenizer attached to editor | 118 ms | 117 ms | 127 ms | 188 ms | — |
| tabs opened | 107 ms | 106 ms | 116 ms | 175 ms | 128 ms |
| built-in extensions registered | 219 ms | 213 ms | 222 ms | 268 ms | 164 ms |
| frame with file text | 117 ms | 116 ms | 126 ms | 186 ms | 137 ms |
| frame with highlighting | 207 ms | 200 ms | 209 ms | 255 ms | — |
| extension host up | 366 ms | 369 ms | 404 ms | 691 ms | 299 ms |
| startup complete | 216 ms | 210 ms | 218 ms | 264 ms | 159 ms |
| to text (black box) | 118 ms | 118 ms | 128 ms | 187 ms | 137 ms |
| to highlight (black box) | 208 ms | 200 ms | 211 ms | 255 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 3 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 21 ms | 6 ms | 6 ms | 4 ms | 8 ms | 4 ms | 2 ms |
| `medium` | 20 ms | 9 ms | 7 ms | 6 ms | 10 ms | 5 ms | 3 ms |
| `large` | 31 ms | 18 ms | 15 ms | 14 ms | 40 ms | 8 ms | 11 ms |
| `xlarge` | 31 ms | 26 ms | 13 ms | 15 ms | 111 ms | 12 ms | 51 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
