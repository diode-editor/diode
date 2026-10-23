# File open benchmark

- Recorded: 2026-10-23T15:12:25.541Z, commit `72436c06f999`, diode nightly-72436c0
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 28 ms; binary floor (`diode --version` over PTY, median): 66 ms; for reference `node --version`: 6 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **146 ms** | 109 ms | 174 ms | 302 ms | 29 ms | 244 MB | 11 |
| `medium` | 126.7 KB | 2000 | **148 ms** | 111 ms | 176 ms | 298 ms | 5 ms | 260 MB | 11 |
| `large` | 1.3 MB | 20000 | **158 ms** | 121 ms | 186 ms | 313 ms | 5 ms | 300 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **251 ms** | 214 ms | 280 ms | 380 ms | 13 ms | 572 MB | 5 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` |
| --- | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 8 ms | 8 ms | 8 ms | 11 ms |
| node ready (bootstrapComplete) | 70 ms | 71 ms | 72 ms | 77 ms |
| bundle executed (main:start) | 70 ms | 71 ms | 73 ms | 77 ms |
| config loaded | 89 ms | 90 ms | 94 ms | 103 ms |
| keybindings loaded | 90 ms | 91 ms | 94 ms | 104 ms |
| session state loaded | 90 ms | 91 ms | 94 ms | 104 ms |
| extensions scanned | 86 ms | 84 ms | 91 ms | 95 ms |
| themes ready | 94 ms | 96 ms | 97 ms | 107 ms |
| DI container created | 98 ms | 100 ms | 102 ms | 111 ms |
| workbench mounted | 135 ms | 132 ms | 135 ms | 142 ms |
| first frame | 135 ms | 132 ms | 135 ms | 142 ms |
| workbench activated | 145 ms | 141 ms | 143 ms | 147 ms |
| grammars preloaded | 150 ms | 146 ms | 149 ms | 155 ms |
| file read from disk | 151 ms | 149 ms | 161 ms | 252 ms |
| file decoded | 151 ms | 149 ms | 161 ms | 252 ms |
| document built | 152 ms | 149 ms | 162 ms | 252 ms |
| tokenizer attached to editor | 173 ms | 176 ms | 188 ms | 280 ms |
| tabs opened | 157 ms | 156 ms | 172 ms | 262 ms |
| built-in extensions registered | 323 ms | 320 ms | 333 ms | 399 ms |
| frame with file text | 172 ms | 174 ms | 186 ms | 278 ms |
| frame with highlighting | 300 ms | 297 ms | 313 ms | 380 ms |
| extension host up | 569 ms | 597 ms | 663 ms | 1306 ms |
| startup complete | 318 ms | 315 ms | 328 ms | 394 ms |
| to text (black box) | 174 ms | 176 ms | 186 ms | 280 ms |
| to highlight (black box) | 302 ms | 298 ms | 313 ms | 380 ms |
| gap black − white (text) | 1 ms | 2 ms | 1 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 35 ms | 14 ms | 9 ms | 11 ms | 17 ms | 6 ms | 5 ms |
| `medium` | 37 ms | 10 ms | 12 ms | 10 ms | 15 ms | 6 ms | 7 ms |
| `large` | 52 ms | 20 ms | 20 ms | 14 ms | 42 ms | 14 ms | 16 ms |
| `xlarge` | 54 ms | 39 ms | 18 ms | 17 ms | 127 ms | 15 ms | 78 ms |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
