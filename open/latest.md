# File open benchmark

- Recorded: 2026-11-16T10:24:21.843Z, commit `4496a36ebe74`, diode nightly-4496a36
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 20 ms; binary floor (`diode --version` over PTY, median): 58 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **131 ms** | 92 ms | 151 ms | 241 ms | 5 ms | 275 MB | 11 |
| `medium` | 126.7 KB | 2000 | **137 ms** | 99 ms | 157 ms | 248 ms | 7 ms | 292 MB | 11 |
| `large` | 1.3 MB | 20000 | **151 ms** | 113 ms | 171 ms | 257 ms | 13 ms | 303 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **199 ms** | 160 ms | 219 ms | 295 ms | 8 ms | 359 MB | 5 |
| `log500m` | 497 MB | 5295839 | **141 ms** | 103 ms | 161 ms | — (plaintext) | 4 ms | 284 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 5 ms | 7 ms | 8 ms | 5 ms |
| node ready (bootstrapComplete) | 63 ms | 65 ms | 66 ms | 71 ms | 60 ms |
| bundle executed (main:start) | 63 ms | 65 ms | 67 ms | 71 ms | 60 ms |
| config loaded | 82 ms | 84 ms | 82 ms | 89 ms | 77 ms |
| keybindings loaded | 82 ms | 84 ms | 84 ms | 90 ms | 77 ms |
| session state loaded | 82 ms | 84 ms | 84 ms | 90 ms | 77 ms |
| extensions scanned | 77 ms | 79 ms | 78 ms | 79 ms | 71 ms |
| themes ready | 85 ms | 87 ms | 87 ms | 93 ms | 80 ms |
| DI container created | 87 ms | 90 ms | 89 ms | 95 ms | 83 ms |
| workbench mounted | 119 ms | 121 ms | 123 ms | 124 ms | 113 ms |
| first frame | 119 ms | 121 ms | 123 ms | 124 ms | 113 ms |
| workbench activated | 126 ms | 130 ms | 129 ms | 130 ms | 120 ms |
| grammars preloaded | 134 ms | 136 ms | 139 ms | 133 ms | 126 ms |
| file read from disk | 136 ms | 139 ms | 150 ms | 196 ms | 133 ms |
| file decoded | 136 ms | 139 ms | 150 ms | 196 ms | 133 ms |
| document built | 136 ms | 139 ms | 151 ms | 197 ms | 133 ms |
| tokenizer attached to editor | 151 ms | 158 ms | 170 ms | 221 ms | — |
| tabs opened | 139 ms | 144 ms | 158 ms | 204 ms | 148 ms |
| built-in extensions registered | 265 ms | 269 ms | 278 ms | 317 ms | 196 ms |
| frame with file text | 150 ms | 156 ms | 169 ms | 219 ms | 160 ms |
| frame with highlighting | 241 ms | 248 ms | 256 ms | 295 ms | — |
| extension host up | 462 ms | 497 ms | 550 ms | 907 ms | 355 ms |
| startup complete | 257 ms | 262 ms | 271 ms | 310 ms | 187 ms |
| to text (black box) | 151 ms | 157 ms | 171 ms | 219 ms | 161 ms |
| to highlight (black box) | 241 ms | 248 ms | 257 ms | 295 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 1 ms | 0 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 34 ms | 12 ms | 8 ms | 8 ms | — | 5 ms | 3 ms |
| `medium` failed | 25 ms | 13 ms | 9 ms | 9 ms | — | 7 ms | 4 ms |
| `large` failed | 32 ms | 21 ms | 17 ms | 18 ms | — | 13 ms | 16 ms |
| `xlarge` failed | 25 ms | 35 ms | 27 ms | 28 ms | — | 16 ms | 68 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
