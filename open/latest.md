# File open benchmark

- Recorded: 2026-11-16T13:26:28.360Z, commit `d262f464e404`, diode nightly-d262f46
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 22 ms; binary floor (`diode --version` over PTY, median): 61 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **137 ms** | 97 ms | 158 ms | 251 ms | 6 ms | 275 MB | 11 |
| `medium` | 126.7 KB | 2000 | **137 ms** | 98 ms | 159 ms | 247 ms | 6 ms | 293 MB | 11 |
| `large` | 1.3 MB | 20000 | **145 ms** | 106 ms | 166 ms | 253 ms | 6 ms | 302 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **213 ms** | 174 ms | 235 ms | 314 ms | 25 ms | 357 MB | 5 |
| `log500m` | 497 MB | 5295839 | **149 ms** | 109 ms | 170 ms | — (plaintext) | 8 ms | 312 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 6 ms | 7 ms | 5 ms |
| node ready (bootstrapComplete) | 65 ms | 67 ms | 67 ms | 75 ms | 60 ms |
| bundle executed (main:start) | 65 ms | 67 ms | 68 ms | 75 ms | 60 ms |
| config loaded | 81 ms | 83 ms | 85 ms | 92 ms | 77 ms |
| keybindings loaded | 82 ms | 86 ms | 86 ms | 92 ms | 78 ms |
| session state loaded | 82 ms | 86 ms | 86 ms | 92 ms | 78 ms |
| extensions scanned | 78 ms | 79 ms | 78 ms | 88 ms | 70 ms |
| themes ready | 87 ms | 89 ms | 90 ms | 97 ms | 81 ms |
| DI container created | 90 ms | 91 ms | 92 ms | 100 ms | 85 ms |
| workbench mounted | 125 ms | 125 ms | 122 ms | 134 ms | 119 ms |
| first frame | 125 ms | 125 ms | 122 ms | 134 ms | 119 ms |
| workbench activated | 135 ms | 131 ms | 129 ms | 140 ms | 131 ms |
| grammars preloaded | 139 ms | 136 ms | 134 ms | 148 ms | 133 ms |
| file read from disk | 141 ms | 139 ms | 143 ms | 212 ms | 142 ms |
| file decoded | 141 ms | 139 ms | 143 ms | 212 ms | 142 ms |
| document built | 141 ms | 139 ms | 144 ms | 212 ms | 143 ms |
| tokenizer attached to editor | 158 ms | 160 ms | 167 ms | 234 ms | — |
| tabs opened | 146 ms | 145 ms | 151 ms | 220 ms | 157 ms |
| built-in extensions registered | 272 ms | 272 ms | 276 ms | 335 ms | 204 ms |
| frame with file text | 158 ms | 158 ms | 164 ms | 232 ms | 170 ms |
| frame with highlighting | 250 ms | 246 ms | 252 ms | 314 ms | — |
| extension host up | 483 ms | 510 ms | 549 ms | 930 ms | 362 ms |
| startup complete | 265 ms | 264 ms | 268 ms | 328 ms | 196 ms |
| to text (black box) | 158 ms | 159 ms | 166 ms | 235 ms | 170 ms |
| to highlight (black box) | 251 ms | 247 ms | 253 ms | 314 ms | — |
| gap black − white (text) | 2 ms | 1 ms | 1 ms | 3 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 31 ms | 11 ms | 9 ms | 13 ms | — | 5 ms | 3 ms |
| `medium` failed | 26 ms | 11 ms | 10 ms | 8 ms | — | 6 ms | 4 ms |
| `large` failed | 32 ms | 19 ms | 15 ms | 17 ms | — | 19 ms | 13 ms |
| `xlarge` failed | 45 ms | 38 ms | 25 ms | 56 ms | — | 19 ms | 62 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
