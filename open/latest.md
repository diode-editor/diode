# File open benchmark

- Recorded: 2026-11-01T23:46:41.758Z, commit `4a8a13dc8bbe`, diode nightly-4a8a13d
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 24 ms; binary floor (`diode --version` over PTY, median): 62 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **142 ms** | 104 ms | 166 ms | 284 ms | 6 ms | 270 MB | 11 |
| `medium` | 126.7 KB | 2000 | **145 ms** | 107 ms | 170 ms | 286 ms | 19 ms | 282 MB | 11 |
| `large` | 1.3 MB | 20000 | **167 ms** | 129 ms | 191 ms | 317 ms | 6 ms | 291 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **259 ms** | 221 ms | 283 ms | 410 ms | 7 ms | 364 MB | 5 |
| `log500m` | 497 MB | 5295839 | **153 ms** | 115 ms | 178 ms | — (plaintext) | 1 ms | 303 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 9 ms | 7 ms | 6 ms |
| node ready (bootstrapComplete) | 66 ms | 68 ms | 71 ms | 86 ms | 63 ms |
| bundle executed (main:start) | 66 ms | 68 ms | 71 ms | 87 ms | 63 ms |
| config loaded | 89 ms | 89 ms | 89 ms | 109 ms | 86 ms |
| keybindings loaded | 89 ms | 89 ms | 89 ms | 109 ms | 86 ms |
| session state loaded | 89 ms | 89 ms | 89 ms | 109 ms | 86 ms |
| extensions scanned | 86 ms | 84 ms | 85 ms | 104 ms | 81 ms |
| themes ready | 93 ms | 93 ms | 94 ms | 113 ms | 90 ms |
| DI container created | 96 ms | 97 ms | 99 ms | 116 ms | 93 ms |
| workbench mounted | 127 ms | 130 ms | 134 ms | 147 ms | 123 ms |
| first frame | 127 ms | 130 ms | 134 ms | 147 ms | 123 ms |
| workbench activated | 134 ms | 139 ms | 139 ms | 151 ms | 128 ms |
| grammars preloaded | 140 ms | 145 ms | 145 ms | 158 ms | 130 ms |
| file read from disk | 142 ms | 148 ms | 161 ms | 258 ms | 143 ms |
| file decoded | 142 ms | 148 ms | 161 ms | 258 ms | 143 ms |
| document built | 142 ms | 148 ms | 161 ms | 259 ms | 143 ms |
| tokenizer attached to editor | 166 ms | 176 ms | 203 ms | 299 ms | — |
| tabs opened | 148 ms | 155 ms | 171 ms | 268 ms | 163 ms |
| built-in extensions registered | 308 ms | 312 ms | 341 ms | 434 ms | 218 ms |
| frame with file text | 164 ms | 170 ms | 186 ms | 282 ms | 177 ms |
| frame with highlighting | 283 ms | 286 ms | 317 ms | 410 ms | — |
| extension host up | 544 ms | 596 ms | 657 ms | 1083 ms | 409 ms |
| startup complete | 303 ms | 306 ms | 336 ms | 428 ms | 210 ms |
| to text (black box) | 166 ms | 170 ms | 191 ms | 283 ms | 178 ms |
| to highlight (black box) | 284 ms | 286 ms | 317 ms | 410 ms | — |
| gap black − white (text) | 3 ms | 1 ms | 2 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 32 ms | 12 ms | 11 ms | 11 ms | 22 ms | 8 ms | 3 ms |
| `medium` | 39 ms | 13 ms | 11 ms | 13 ms | 22 ms | 8 ms | 5 ms |
| `large` | 39 ms | 24 ms | 29 ms | 23 ms | 43 ms | 14 ms | 17 ms |
| `xlarge` | 30 ms | 35 ms | 20 ms | 20 ms | 129 ms | 14 ms | 76 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
