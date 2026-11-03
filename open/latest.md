# File open benchmark

- Recorded: 2026-11-03T23:05:47.109Z, commit `92ee1ba188e1`, diode nightly-92ee1ba
- Machine: AMD EPYC 9V45 96-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 21 ms; binary floor (`diode --version` over PTY, median): 49 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **107 ms** | 79 ms | 127 ms | 208 ms | 10 ms | 259 MB | 11 |
| `medium` | 126.7 KB | 2000 | **111 ms** | 82 ms | 131 ms | 212 ms | 5 ms | 282 MB | 11 |
| `large` | 1.3 MB | 20000 | **127 ms** | 99 ms | 147 ms | 227 ms | 7 ms | 300 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **186 ms** | 158 ms | 207 ms | 273 ms | 7 ms | 354 MB | 5 |
| `log500m` | 497 MB | 5295839 | **122 ms** | 94 ms | 142 ms | — (plaintext) | 9 ms | 274 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 8 ms | 9 ms | 6 ms |
| node ready (bootstrapComplete) | 55 ms | 57 ms | 63 ms | 73 ms | 52 ms |
| bundle executed (main:start) | 55 ms | 57 ms | 63 ms | 73 ms | 52 ms |
| config loaded | 69 ms | 73 ms | 77 ms | 96 ms | 68 ms |
| keybindings loaded | 69 ms | 74 ms | 77 ms | 96 ms | 68 ms |
| session state loaded | 69 ms | 74 ms | 77 ms | 96 ms | 68 ms |
| extensions scanned | 67 ms | 69 ms | 74 ms | 92 ms | 65 ms |
| themes ready | 73 ms | 76 ms | 80 ms | 99 ms | 71 ms |
| DI container created | 76 ms | 78 ms | 83 ms | 102 ms | 75 ms |
| workbench mounted | 99 ms | 101 ms | 107 ms | 124 ms | 99 ms |
| first frame | 99 ms | 101 ms | 107 ms | 124 ms | 99 ms |
| workbench activated | 103 ms | 104 ms | 111 ms | 128 ms | 103 ms |
| grammars preloaded | 111 ms | 110 ms | 119 ms | 131 ms | 108 ms |
| file read from disk | 112 ms | 113 ms | 129 ms | 183 ms | 116 ms |
| file decoded | 112 ms | 113 ms | 129 ms | 183 ms | 116 ms |
| document built | 113 ms | 113 ms | 130 ms | 183 ms | 116 ms |
| tokenizer attached to editor | 126 ms | 130 ms | 149 ms | 206 ms | — |
| tabs opened | 116 ms | 118 ms | 137 ms | 192 ms | 130 ms |
| built-in extensions registered | 225 ms | 230 ms | 247 ms | 291 ms | 171 ms |
| frame with file text | 125 ms | 128 ms | 147 ms | 204 ms | 140 ms |
| frame with highlighting | 208 ms | 212 ms | 227 ms | 273 ms | — |
| extension host up | 394 ms | 427 ms | 469 ms | 827 ms | 321 ms |
| startup complete | 220 ms | 226 ms | 242 ms | 286 ms | 166 ms |
| to text (black box) | 127 ms | 131 ms | 147 ms | 207 ms | 142 ms |
| to highlight (black box) | 208 ms | 212 ms | 227 ms | 273 ms | — |
| gap black − white (text) | 2 ms | 1 ms | 2 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 11 ms | 8 ms | 7 ms | 6 ms | — | 4 ms | 3 ms |
| `medium` failed | 26 ms | 14 ms | 8 ms | 9 ms | — | 4 ms | 5 ms |
| `large` failed | 30 ms | 18 ms | 16 ms | 15 ms | — | 16 ms | 13 ms |
| `xlarge` failed | 27 ms | 27 ms | 18 ms | 20 ms | — | 14 ms | 54 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
