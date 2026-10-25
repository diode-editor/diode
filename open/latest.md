# File open benchmark

- Recorded: 2026-10-25T14:20:51.164Z, commit `49b43c0ebd76`, diode nightly-49b43c0
- Machine: Intel(R) Xeon(R) 6973P-C (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 21 ms; binary floor (`diode --version` over PTY, median): 50 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **105 ms** | 76 ms | 126 ms | 219 ms | 17 ms | 244 MB | 11 |
| `medium` | 126.7 KB | 2000 | **103 ms** | 74 ms | 124 ms | 206 ms | 6 ms | 247 MB | 11 |
| `large` | 1.3 MB | 20000 | **115 ms** | 87 ms | 136 ms | 222 ms | 9 ms | 288 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **175 ms** | 146 ms | 196 ms | 273 ms | 9 ms | 355 MB | 5 |
| `log500m` | 497 MB | 5295839 | **107 ms** | 79 ms | 128 ms | — (plaintext) | 3 ms | 265 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 5 ms | 6 ms | 7 ms | 5 ms |
| node ready (bootstrapComplete) | 53 ms | 53 ms | 52 ms | 58 ms | 49 ms |
| bundle executed (main:start) | 53 ms | 53 ms | 52 ms | 58 ms | 49 ms |
| config loaded | 69 ms | 64 ms | 67 ms | 72 ms | 62 ms |
| keybindings loaded | 69 ms | 64 ms | 68 ms | 72 ms | 63 ms |
| session state loaded | 70 ms | 64 ms | 68 ms | 73 ms | 63 ms |
| extensions scanned | 65 ms | 62 ms | 64 ms | 71 ms | 60 ms |
| themes ready | 71 ms | 68 ms | 71 ms | 76 ms | 66 ms |
| DI container created | 75 ms | 71 ms | 73 ms | 79 ms | 69 ms |
| workbench mounted | 97 ms | 93 ms | 94 ms | 99 ms | 91 ms |
| first frame | 97 ms | 93 ms | 94 ms | 99 ms | 91 ms |
| workbench activated | 100 ms | 97 ms | 98 ms | 103 ms | 94 ms |
| grammars preloaded | 109 ms | 105 ms | 107 ms | 112 ms | 98 ms |
| file read from disk | 111 ms | 107 ms | 116 ms | 176 ms | 106 ms |
| file decoded | 111 ms | 107 ms | 116 ms | 176 ms | 106 ms |
| document built | 111 ms | 108 ms | 116 ms | 176 ms | 106 ms |
| tokenizer attached to editor | 125 ms | 124 ms | 136 ms | 196 ms | — |
| tabs opened | 114 ms | 112 ms | 123 ms | 184 ms | 117 ms |
| built-in extensions registered | 231 ms | 223 ms | 235 ms | 286 ms | 151 ms |
| frame with file text | 124 ms | 122 ms | 134 ms | 195 ms | 126 ms |
| frame with highlighting | 218 ms | 206 ms | 222 ms | 273 ms | — |
| extension host up | 393 ms | 387 ms | 445 ms | 707 ms | 281 ms |
| startup complete | 228 ms | 218 ms | 231 ms | 282 ms | 147 ms |
| to text (black box) | 126 ms | 124 ms | 136 ms | 196 ms | 128 ms |
| to highlight (black box) | 219 ms | 206 ms | 222 ms | 273 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 1 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 22 ms | 10 ms | 11 ms | 7 ms | 10 ms | 5 ms | 3 ms |
| `medium` | 27 ms | 10 ms | 7 ms | 7 ms | 11 ms | 5 ms | 3 ms |
| `large` | 33 ms | 20 ms | 15 ms | 17 ms | 37 ms | 13 ms | 11 ms |
| `xlarge` | 24 ms | 21 ms | 10 ms | 15 ms | 121 ms | 12 ms | 55 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
