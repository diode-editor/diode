# File open benchmark

- Recorded: 2026-10-21T20:57:06.241Z, commit `7b823f03c322`, diode nightly-7b823f0
- Machine: AMD EPYC 9V45 96-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 19 ms; binary floor (`diode --version` over PTY, median): 42 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **88 ms** | 65 ms | 107 ms | 182 ms | 10 ms | 243 MB | 11 |
| `medium` | 126.7 KB | 2000 | **112 ms** | 89 ms | 131 ms | 208 ms | 6 ms | 247 MB | 11 |
| `large` | 1.3 MB | 20000 | **243 ms** | 220 ms | 262 ms | 337 ms | 35 ms | 301 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **1075 ms** | 1052 ms | 1094 ms | 1210 ms | 42 ms | 508 MB | 5 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` |
| --- | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 6 ms | 7 ms | 12 ms |
| node ready (bootstrapComplete) | 47 ms | 47 ms | 57 ms | 73 ms |
| bundle executed (main:start) | 47 ms | 47 ms | 57 ms | 73 ms |
| config loaded | 59 ms | 59 ms | 71 ms | 93 ms |
| keybindings loaded | 59 ms | 59 ms | 72 ms | 98 ms |
| session state loaded | 59 ms | 59 ms | 72 ms | 98 ms |
| extensions scanned | 57 ms | 57 ms | 69 ms | 87 ms |
| themes ready | 61 ms | 62 ms | 75 ms | 101 ms |
| DI container created | 63 ms | 65 ms | 78 ms | 107 ms |
| workbench mounted | 82 ms | 84 ms | 101 ms | 125 ms |
| first frame | 82 ms | 84 ms | 101 ms | 125 ms |
| workbench activated | 85 ms | 88 ms | 105 ms | 129 ms |
| grammars preloaded | 92 ms | 95 ms | 113 ms | 135 ms |
| file read from disk | 93 ms | 97 ms | 124 ms | 193 ms |
| file decoded | 93 ms | 97 ms | 124 ms | 193 ms |
| document built | 93 ms | 97 ms | 124 ms | 193 ms |
| tokenizer attached to editor | 107 ms | 130 ms | 264 ms | 1096 ms |
| tabs opened | 96 ms | 102 ms | 142 ms | 222 ms |
| built-in extensions registered | 196 ms | 222 ms | 350 ms | 1223 ms |
| frame with file text | 106 ms | 129 ms | 262 ms | 1094 ms |
| frame with highlighting | 182 ms | 208 ms | 337 ms | 1210 ms |
| extension host up | 345 ms | 390 ms | 555 ms | 1613 ms |
| startup complete | 192 ms | 219 ms | 347 ms | 1221 ms |
| to text (black box) | 107 ms | 131 ms | 262 ms | 1094 ms |
| to highlight (black box) | 182 ms | 208 ms | 337 ms | 1210 ms |
| gap black − white (text) | 1 ms | 2 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 29 ms | 10 ms | 7 ms | 7 ms | 9 ms | 5 ms | 2 ms |
| `medium` | 25 ms | 13 ms | 11 ms | 9 ms | 12 ms | 4 ms | 3 ms |
| `large` | 52 ms | 38 ms | 38 ms | 45 ms | 50 ms | 10 ms | 11 ms |
| `xlarge` | 147 ms | 193 ms | 231 ms | 206 ms | 254 ms | 8 ms | 40 ms |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
