# File open benchmark

- Recorded: 2026-11-17T20:20:02.262Z, commit `e5c4b3d54234`, diode nightly-e5c4b3d
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 20 ms; binary floor (`diode --version` over PTY, median): 61 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **142 ms** | 102 ms | 163 ms | 251 ms | 11 ms | 287 MB | 11 |
| `medium` | 126.7 KB | 2000 | **144 ms** | 104 ms | 165 ms | 263 ms | 10 ms | 296 MB | 11 |
| `large` | 1.3 MB | 20000 | **162 ms** | 121 ms | 182 ms | 277 ms | 5 ms | 305 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **231 ms** | 190 ms | 251 ms | 336 ms | 18 ms | 361 MB | 5 |
| `log500m` | 497 MB | 5295839 | **153 ms** | 112 ms | 173 ms | — (plaintext) | 3 ms | 320 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 6 ms | 7 ms | 8 ms | 6 ms |
| node ready (bootstrapComplete) | 67 ms | 69 ms | 74 ms | 84 ms | 65 ms |
| bundle executed (main:start) | 67 ms | 69 ms | 74 ms | 84 ms | 65 ms |
| config loaded | 87 ms | 87 ms | 92 ms | 108 ms | 83 ms |
| keybindings loaded | 87 ms | 88 ms | 93 ms | 108 ms | 85 ms |
| session state loaded | 87 ms | 88 ms | 93 ms | 108 ms | 85 ms |
| extensions scanned | 83 ms | 83 ms | 88 ms | 103 ms | 78 ms |
| themes ready | 92 ms | 92 ms | 98 ms | 111 ms | 88 ms |
| DI container created | 96 ms | 95 ms | 101 ms | 114 ms | 91 ms |
| workbench mounted | 131 ms | 128 ms | 138 ms | 148 ms | 127 ms |
| first frame | 131 ms | 128 ms | 138 ms | 148 ms | 127 ms |
| workbench activated | 137 ms | 136 ms | 145 ms | 154 ms | 133 ms |
| grammars preloaded | 141 ms | 139 ms | 149 ms | 160 ms | 135 ms |
| file read from disk | 143 ms | 142 ms | 159 ms | 229 ms | 145 ms |
| file decoded | 143 ms | 142 ms | 159 ms | 229 ms | 145 ms |
| document built | 144 ms | 142 ms | 159 ms | 229 ms | 145 ms |
| tokenizer attached to editor | 163 ms | 167 ms | 183 ms | 253 ms | — |
| tabs opened | 147 ms | 149 ms | 168 ms | 237 ms | 161 ms |
| built-in extensions registered | 275 ms | 284 ms | 300 ms | 358 ms | 210 ms |
| frame with file text | 162 ms | 163 ms | 180 ms | 251 ms | 173 ms |
| frame with highlighting | 250 ms | 262 ms | 277 ms | 336 ms | — |
| extension host up | 477 ms | 529 ms | 603 ms | 975 ms | 383 ms |
| startup complete | 266 ms | 277 ms | 292 ms | 352 ms | 202 ms |
| to text (black box) | 163 ms | 165 ms | 182 ms | 251 ms | 173 ms |
| to highlight (black box) | 251 ms | 263 ms | 277 ms | 336 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 28 ms | 15 ms | 11 ms | 11 ms | — | 6 ms | 3 ms |
| `medium` failed | 28 ms | 15 ms | 10 ms | 8 ms | — | 8 ms | 5 ms |
| `large` failed | 35 ms | 27 ms | 16 ms | 25 ms | — | 16 ms | 15 ms |
| `xlarge` failed | 44 ms | 39 ms | 25 ms | 26 ms | — | 13 ms | 66 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
