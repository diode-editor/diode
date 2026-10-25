# File open benchmark

- Recorded: 2026-10-25T16:26:33.928Z, commit `47378cf10712`, diode nightly-47378cf
- Machine: Intel(R) Xeon(R) 6973P-C (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 22 ms; binary floor (`diode --version` over PTY, median): 54 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **103 ms** | 70 ms | 124 ms | 210 ms | 3 ms | 244 MB | 11 |
| `medium` | 126.7 KB | 2000 | **102 ms** | 70 ms | 124 ms | 214 ms | 7 ms | 248 MB | 11 |
| `large` | 1.3 MB | 20000 | **112 ms** | 79 ms | 134 ms | 222 ms | 8 ms | 291 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **184 ms** | 152 ms | 206 ms | 281 ms | 3 ms | 358 MB | 5 |
| `log500m` | 497 MB | 5295839 | **109 ms** | 77 ms | 131 ms | — (plaintext) | 3 ms | 264 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 5 ms | 5 ms | 7 ms | 5 ms |
| node ready (bootstrapComplete) | 52 ms | 51 ms | 53 ms | 57 ms | 49 ms |
| bundle executed (main:start) | 52 ms | 51 ms | 53 ms | 57 ms | 49 ms |
| config loaded | 65 ms | 63 ms | 68 ms | 69 ms | 61 ms |
| keybindings loaded | 65 ms | 64 ms | 70 ms | 69 ms | 62 ms |
| session state loaded | 65 ms | 64 ms | 70 ms | 69 ms | 62 ms |
| extensions scanned | 63 ms | 61 ms | 65 ms | 67 ms | 60 ms |
| themes ready | 68 ms | 67 ms | 72 ms | 72 ms | 65 ms |
| DI container created | 71 ms | 70 ms | 75 ms | 75 ms | 69 ms |
| workbench mounted | 94 ms | 93 ms | 95 ms | 97 ms | 91 ms |
| first frame | 94 ms | 93 ms | 95 ms | 97 ms | 91 ms |
| workbench activated | 98 ms | 97 ms | 98 ms | 101 ms | 95 ms |
| grammars preloaded | 107 ms | 105 ms | 107 ms | 110 ms | 102 ms |
| file read from disk | 109 ms | 107 ms | 116 ms | 185 ms | 110 ms |
| file decoded | 109 ms | 108 ms | 116 ms | 186 ms | 110 ms |
| document built | 109 ms | 108 ms | 116 ms | 186 ms | 110 ms |
| tokenizer attached to editor | 122 ms | 124 ms | 135 ms | 207 ms | — |
| tabs opened | 111 ms | 112 ms | 122 ms | 193 ms | 122 ms |
| built-in extensions registered | 223 ms | 226 ms | 235 ms | 295 ms | 156 ms |
| frame with file text | 122 ms | 122 ms | 133 ms | 205 ms | 131 ms |
| frame with highlighting | 209 ms | 212 ms | 222 ms | 281 ms | — |
| extension host up | 379 ms | 395 ms | 444 ms | 747 ms | 282 ms |
| startup complete | 218 ms | 223 ms | 231 ms | 291 ms | 152 ms |
| to text (black box) | 124 ms | 124 ms | 134 ms | 206 ms | 131 ms |
| to highlight (black box) | 210 ms | 214 ms | 222 ms | 281 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 1 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 25 ms | 8 ms | 8 ms | 10 ms | 12 ms | 7 ms | 2 ms |
| `medium` | 23 ms | 10 ms | 9 ms | 6 ms | 14 ms | 5 ms | 3 ms |
| `large` | 30 ms | 20 ms | 16 ms | 20 ms | 41 ms | 12 ms | 11 ms |
| `xlarge` | 23 ms | 20 ms | 17 ms | 16 ms | 113 ms | 11 ms | 52 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
