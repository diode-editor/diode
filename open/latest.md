# File open benchmark

- Recorded: 2026-10-21T18:34:28.406Z, commit `2044bb1d67e0`, diode nightly-2044bb1
- Machine: Intel(R) Xeon(R) 6973P-C (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 20 ms; binary floor (`diode --version` over PTY, median): 48 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **108 ms** | 80 ms | 128 ms | 219 ms | 10 ms | 244 MB | 11 |
| `medium` | 126.7 KB | 2000 | **124 ms** | 97 ms | 145 ms | 235 ms | 4 ms | 247 MB | 11 |
| `large` | 1.3 MB | 20000 | **237 ms** | 209 ms | 257 ms | 341 ms | 13 ms | 301 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **1169 ms** | 1142 ms | 1189 ms | 1311 ms | 29 ms | 498 MB | 5 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` |
| --- | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 7 ms | 6 ms | 7 ms |
| node ready (bootstrapComplete) | 52 ms | 50 ms | 52 ms | 61 ms |
| bundle executed (main:start) | 53 ms | 50 ms | 52 ms | 61 ms |
| config loaded | 66 ms | 64 ms | 68 ms | 72 ms |
| keybindings loaded | 66 ms | 66 ms | 70 ms | 73 ms |
| session state loaded | 66 ms | 66 ms | 70 ms | 73 ms |
| extensions scanned | 62 ms | 61 ms | 63 ms | 70 ms |
| themes ready | 69 ms | 68 ms | 73 ms | 76 ms |
| DI container created | 73 ms | 71 ms | 76 ms | 79 ms |
| workbench mounted | 95 ms | 93 ms | 94 ms | 102 ms |
| first frame | 95 ms | 93 ms | 94 ms | 102 ms |
| workbench activated | 100 ms | 97 ms | 98 ms | 107 ms |
| grammars preloaded | 110 ms | 105 ms | 104 ms | 115 ms |
| file read from disk | 111 ms | 107 ms | 116 ms | 181 ms |
| file decoded | 111 ms | 107 ms | 116 ms | 181 ms |
| document built | 111 ms | 107 ms | 116 ms | 181 ms |
| tokenizer attached to editor | 128 ms | 145 ms | 259 ms | 1191 ms |
| tabs opened | 115 ms | 114 ms | 132 ms | 213 ms |
| built-in extensions registered | 234 ms | 248 ms | 354 ms | 1323 ms |
| frame with file text | 127 ms | 143 ms | 257 ms | 1189 ms |
| frame with highlighting | 219 ms | 234 ms | 341 ms | 1311 ms |
| extension host up | 425 ms | 427 ms | 560 ms | 1794 ms |
| startup complete | 229 ms | 244 ms | 350 ms | 1320 ms |
| to text (black box) | 128 ms | 145 ms | 257 ms | 1189 ms |
| to highlight (black box) | 219 ms | 235 ms | 341 ms | 1311 ms |
| gap black − white (text) | 2 ms | 2 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 32 ms | 11 ms | 10 ms | 8 ms | 14 ms | 7 ms | 2 ms |
| `medium` | 29 ms | 13 ms | 11 ms | 10 ms | 12 ms | 7 ms | 4 ms |
| `large` | 49 ms | 43 ms | 36 ms | 40 ms | 46 ms | 9 ms | 14 ms |
| `xlarge` | 153 ms | 160 ms | 215 ms | 198 ms | 256 ms | 9 ms | 40 ms |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
