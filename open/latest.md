# File open benchmark

- Recorded: 2026-11-14T23:15:05.486Z, commit `c6e377257ef5`, diode nightly-c6e3772
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 20 ms; binary floor (`diode --version` over PTY, median): 57 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **130 ms** | 93 ms | 150 ms | 239 ms | 8 ms | 269 MB | 11 |
| `medium` | 126.7 KB | 2000 | **129 ms** | 92 ms | 149 ms | 236 ms | 6 ms | 289 MB | 11 |
| `large` | 1.3 MB | 20000 | **146 ms** | 109 ms | 166 ms | 253 ms | 7 ms | 303 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **210 ms** | 174 ms | 230 ms | 306 ms | 4 ms | 358 MB | 5 |
| `log500m` | 497 MB | 5295839 | **141 ms** | 104 ms | 161 ms | — (plaintext) | 2 ms | 281 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 5 ms | 6 ms | 7 ms | 5 ms |
| node ready (bootstrapComplete) | 61 ms | 60 ms | 66 ms | 79 ms | 58 ms |
| bundle executed (main:start) | 61 ms | 60 ms | 66 ms | 79 ms | 58 ms |
| config loaded | 78 ms | 79 ms | 80 ms | 94 ms | 71 ms |
| keybindings loaded | 78 ms | 81 ms | 81 ms | 96 ms | 71 ms |
| session state loaded | 78 ms | 81 ms | 81 ms | 96 ms | 71 ms |
| extensions scanned | 75 ms | 75 ms | 77 ms | 90 ms | 67 ms |
| themes ready | 83 ms | 84 ms | 85 ms | 100 ms | 75 ms |
| DI container created | 86 ms | 86 ms | 88 ms | 102 ms | 79 ms |
| workbench mounted | 117 ms | 114 ms | 121 ms | 133 ms | 112 ms |
| first frame | 117 ms | 114 ms | 121 ms | 133 ms | 112 ms |
| workbench activated | 123 ms | 120 ms | 127 ms | 139 ms | 119 ms |
| grammars preloaded | 131 ms | 124 ms | 132 ms | 146 ms | 127 ms |
| file read from disk | 133 ms | 127 ms | 145 ms | 210 ms | 134 ms |
| file decoded | 133 ms | 127 ms | 145 ms | 210 ms | 134 ms |
| document built | 133 ms | 128 ms | 145 ms | 210 ms | 135 ms |
| tokenizer attached to editor | 148 ms | 148 ms | 167 ms | 231 ms | — |
| tabs opened | 136 ms | 133 ms | 153 ms | 217 ms | 149 ms |
| built-in extensions registered | 261 ms | 259 ms | 274 ms | 329 ms | 197 ms |
| frame with file text | 148 ms | 146 ms | 164 ms | 230 ms | 161 ms |
| frame with highlighting | 239 ms | 235 ms | 253 ms | 306 ms | — |
| extension host up | 460 ms | 501 ms | 548 ms | 918 ms | 361 ms |
| startup complete | 254 ms | 251 ms | 267 ms | 320 ms | 188 ms |
| to text (black box) | 150 ms | 149 ms | 166 ms | 230 ms | 161 ms |
| to highlight (black box) | 239 ms | 236 ms | 253 ms | 306 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 1 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 25 ms | 11 ms | 10 ms | 9 ms | — | 6 ms | 3 ms |
| `medium` failed | 28 ms | 12 ms | 10 ms | 8 ms | — | 6 ms | 4 ms |
| `large` failed | 36 ms | 26 ms | 20 ms | 20 ms | — | 15 ms | 18 ms |
| `xlarge` failed | 45 ms | 32 ms | 21 ms | 42 ms | — | 21 ms | 61 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
