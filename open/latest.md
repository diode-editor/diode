# File open benchmark

- Recorded: 2026-10-25T10:18:30.548Z, commit `99fd1467e2a1`, diode nightly-99fd146
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 21 ms; binary floor (`diode --version` over PTY, median): 51 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **112 ms** | 82 ms | 133 ms | 221 ms | 7 ms | 244 MB | 11 |
| `medium` | 126.7 KB | 2000 | **114 ms** | 83 ms | 135 ms | 226 ms | 8 ms | 246 MB | 11 |
| `large` | 1.3 MB | 20000 | **134 ms** | 104 ms | 155 ms | 251 ms | 17 ms | 291 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **197 ms** | 166 ms | 217 ms | 295 ms | 11 ms | 354 MB | 5 |
| `log500m` | 497 MB | 5295839 | **115 ms** | 85 ms | 136 ms | — (plaintext) | 3 ms | 261 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 8 ms | 10 ms | 5 ms |
| node ready (bootstrapComplete) | 59 ms | 58 ms | 63 ms | 72 ms | 53 ms |
| bundle executed (main:start) | 59 ms | 58 ms | 63 ms | 72 ms | 53 ms |
| config loaded | 73 ms | 72 ms | 77 ms | 84 ms | 65 ms |
| keybindings loaded | 73 ms | 72 ms | 77 ms | 84 ms | 65 ms |
| session state loaded | 73 ms | 72 ms | 78 ms | 85 ms | 66 ms |
| extensions scanned | 70 ms | 70 ms | 76 ms | 81 ms | 64 ms |
| themes ready | 77 ms | 75 ms | 81 ms | 88 ms | 69 ms |
| DI container created | 80 ms | 81 ms | 84 ms | 91 ms | 72 ms |
| workbench mounted | 104 ms | 103 ms | 110 ms | 117 ms | 95 ms |
| first frame | 104 ms | 103 ms | 110 ms | 117 ms | 95 ms |
| workbench activated | 108 ms | 107 ms | 114 ms | 121 ms | 99 ms |
| grammars preloaded | 117 ms | 115 ms | 123 ms | 128 ms | 105 ms |
| file read from disk | 119 ms | 118 ms | 136 ms | 200 ms | 113 ms |
| file decoded | 119 ms | 118 ms | 136 ms | 200 ms | 113 ms |
| document built | 119 ms | 118 ms | 136 ms | 200 ms | 113 ms |
| tokenizer attached to editor | 133 ms | 136 ms | 157 ms | 219 ms | — |
| tabs opened | 121 ms | 122 ms | 144 ms | 207 ms | 127 ms |
| built-in extensions registered | 240 ms | 242 ms | 265 ms | 310 ms | 165 ms |
| frame with file text | 132 ms | 134 ms | 154 ms | 217 ms | 136 ms |
| frame with highlighting | 221 ms | 226 ms | 251 ms | 295 ms | — |
| extension host up | 418 ms | 438 ms | 491 ms | 766 ms | 305 ms |
| startup complete | 236 ms | 239 ms | 262 ms | 306 ms | 161 ms |
| to text (black box) | 133 ms | 135 ms | 155 ms | 217 ms | 136 ms |
| to highlight (black box) | 221 ms | 226 ms | 251 ms | 295 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 2 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 27 ms | 8 ms | 8 ms | 9 ms | 12 ms | 7 ms | 2 ms |
| `medium` | 24 ms | 11 ms | 8 ms | 8 ms | 14 ms | 5 ms | 3 ms |
| `large` | 47 ms | 22 ms | 20 ms | 18 ms | 42 ms | 9 ms | 13 ms |
| `xlarge` | 21 ms | 22 ms | 13 ms | 18 ms | 107 ms | 18 ms | 69 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
