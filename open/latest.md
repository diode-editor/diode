# File open benchmark

- Recorded: 2026-10-25T10:49:40.842Z, commit `a34e98d3355a`, diode nightly-a34e98d
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 20 ms; binary floor (`diode --version` over PTY, median): 50 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **108 ms** | 78 ms | 127 ms | 215 ms | 8 ms | 243 MB | 11 |
| `medium` | 126.7 KB | 2000 | **111 ms** | 81 ms | 131 ms | 219 ms | 3 ms | 247 MB | 11 |
| `large` | 1.3 MB | 20000 | **120 ms** | 90 ms | 140 ms | 228 ms | 6 ms | 289 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **190 ms** | 160 ms | 210 ms | 288 ms | 10 ms | 358 MB | 5 |
| `log500m` | 497 MB | 5295839 | **117 ms** | 87 ms | 137 ms | — (plaintext) | 2 ms | 263 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 5 ms | 6 ms | 7 ms | 5 ms |
| node ready (bootstrapComplete) | 56 ms | 55 ms | 57 ms | 65 ms | 51 ms |
| bundle executed (main:start) | 56 ms | 55 ms | 57 ms | 65 ms | 51 ms |
| config loaded | 73 ms | 72 ms | 70 ms | 81 ms | 66 ms |
| keybindings loaded | 73 ms | 72 ms | 71 ms | 81 ms | 66 ms |
| session state loaded | 73 ms | 72 ms | 71 ms | 81 ms | 66 ms |
| extensions scanned | 71 ms | 70 ms | 68 ms | 77 ms | 63 ms |
| themes ready | 75 ms | 75 ms | 74 ms | 84 ms | 69 ms |
| DI container created | 79 ms | 78 ms | 77 ms | 87 ms | 72 ms |
| workbench mounted | 100 ms | 101 ms | 101 ms | 112 ms | 95 ms |
| first frame | 100 ms | 101 ms | 101 ms | 112 ms | 95 ms |
| workbench activated | 104 ms | 105 ms | 104 ms | 116 ms | 99 ms |
| grammars preloaded | 110 ms | 111 ms | 110 ms | 124 ms | 102 ms |
| file read from disk | 112 ms | 114 ms | 120 ms | 189 ms | 113 ms |
| file decoded | 112 ms | 114 ms | 120 ms | 189 ms | 113 ms |
| document built | 112 ms | 114 ms | 120 ms | 189 ms | 113 ms |
| tokenizer attached to editor | 126 ms | 131 ms | 139 ms | 210 ms | — |
| tabs opened | 115 ms | 119 ms | 127 ms | 195 ms | 127 ms |
| built-in extensions registered | 229 ms | 236 ms | 242 ms | 304 ms | 164 ms |
| frame with file text | 126 ms | 130 ms | 137 ms | 208 ms | 136 ms |
| frame with highlighting | 214 ms | 219 ms | 227 ms | 288 ms | — |
| extension host up | 403 ms | 424 ms | 478 ms | 761 ms | 300 ms |
| startup complete | 226 ms | 232 ms | 238 ms | 299 ms | 159 ms |
| to text (black box) | 127 ms | 131 ms | 140 ms | 210 ms | 137 ms |
| to highlight (black box) | 215 ms | 219 ms | 228 ms | 288 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 2 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 23 ms | 9 ms | 7 ms | 7 ms | 10 ms | 5 ms | 2 ms |
| `medium` | 26 ms | 10 ms | 7 ms | 7 ms | 11 ms | 5 ms | 3 ms |
| `large` | 26 ms | 14 ms | 12 ms | 11 ms | 41 ms | 10 ms | 12 ms |
| `xlarge` | 24 ms | 20 ms | 13 ms | 18 ms | 125 ms | 10 ms | 62 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
