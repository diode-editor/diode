# File open benchmark

- Recorded: 2026-11-02T07:11:52.518Z, commit `0920caae2507`, diode nightly-0920caa
- Machine: AMD EPYC 9V45 96-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 21 ms; binary floor (`diode --version` over PTY, median): 50 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **106 ms** | 77 ms | 127 ms | 207 ms | 3 ms | 257 MB | 11 |
| `medium` | 126.7 KB | 2000 | **106 ms** | 77 ms | 127 ms | 211 ms | 4 ms | 283 MB | 11 |
| `large` | 1.3 MB | 20000 | **120 ms** | 91 ms | 141 ms | 233 ms | 6 ms | 298 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **191 ms** | 162 ms | 212 ms | 320 ms | 10 ms | 374 MB | 5 |
| `log500m` | 497 MB | 5295839 | **115 ms** | 86 ms | 136 ms | — (plaintext) | 1 ms | 273 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 5 ms | 6 ms | 9 ms | 6 ms |
| node ready (bootstrapComplete) | 55 ms | 54 ms | 59 ms | 68 ms | 51 ms |
| bundle executed (main:start) | 55 ms | 54 ms | 59 ms | 69 ms | 51 ms |
| config loaded | 68 ms | 69 ms | 71 ms | 86 ms | 65 ms |
| keybindings loaded | 68 ms | 69 ms | 71 ms | 87 ms | 65 ms |
| session state loaded | 68 ms | 69 ms | 71 ms | 87 ms | 65 ms |
| extensions scanned | 65 ms | 65 ms | 68 ms | 82 ms | 63 ms |
| themes ready | 71 ms | 72 ms | 74 ms | 92 ms | 69 ms |
| DI container created | 75 ms | 76 ms | 78 ms | 95 ms | 72 ms |
| workbench mounted | 99 ms | 97 ms | 102 ms | 117 ms | 96 ms |
| first frame | 99 ms | 97 ms | 102 ms | 117 ms | 96 ms |
| workbench activated | 103 ms | 100 ms | 105 ms | 121 ms | 100 ms |
| grammars preloaded | 110 ms | 108 ms | 112 ms | 130 ms | 107 ms |
| file read from disk | 112 ms | 110 ms | 120 ms | 189 ms | 113 ms |
| file decoded | 112 ms | 110 ms | 120 ms | 189 ms | 113 ms |
| document built | 112 ms | 110 ms | 120 ms | 189 ms | 114 ms |
| tokenizer attached to editor | 128 ms | 131 ms | 159 ms | 239 ms | — |
| tabs opened | 116 ms | 115 ms | 127 ms | 201 ms | 126 ms |
| built-in extensions registered | 227 ms | 229 ms | 252 ms | 338 ms | 165 ms |
| frame with file text | 126 ms | 125 ms | 139 ms | 211 ms | 136 ms |
| frame with highlighting | 207 ms | 210 ms | 233 ms | 320 ms | — |
| extension host up | 393 ms | 416 ms | 466 ms | 815 ms | 306 ms |
| startup complete | 222 ms | 225 ms | 247 ms | 334 ms | 160 ms |
| to text (black box) | 127 ms | 127 ms | 141 ms | 212 ms | 136 ms |
| to highlight (black box) | 207 ms | 211 ms | 233 ms | 320 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 1 ms | 3 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 18 ms | 9 ms | 7 ms | 7 ms | 9 ms | 4 ms | 3 ms |
| `medium` | 22 ms | 13 ms | 9 ms | 7 ms | 19 ms | 5 ms | 4 ms |
| `large` | 27 ms | 16 ms | 14 ms | 15 ms | 51 ms | 10 ms | 11 ms |
| `xlarge` | 29 ms | 28 ms | 20 ms | 22 ms | 169 ms | 12 ms | 45 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
