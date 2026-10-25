# File open benchmark

- Recorded: 2026-10-25T10:13:46.468Z, commit `523e6d2cffb0`, diode nightly-523e6d2
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 59 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **126 ms** | 92 ms | 151 ms | 265 ms | 4 ms | 243 MB | 11 |
| `medium` | 126.7 KB | 2000 | **136 ms** | 101 ms | 161 ms | 272 ms | 6 ms | 247 MB | 11 |
| `large` | 1.3 MB | 20000 | **147 ms** | 112 ms | 172 ms | 286 ms | 7 ms | 288 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **226 ms** | 191 ms | 251 ms | 351 ms | 18 ms | 355 MB | 5 |
| `log500m` | 497 MB | 5295839 | **149 ms** | 114 ms | 174 ms | — (plaintext) | 4 ms | 283 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 6 ms | 6 ms | 8 ms | 6 ms |
| node ready (bootstrapComplete) | 63 ms | 63 ms | 67 ms | 70 ms | 60 ms |
| bundle executed (main:start) | 63 ms | 63 ms | 67 ms | 70 ms | 60 ms |
| config loaded | 81 ms | 79 ms | 85 ms | 88 ms | 82 ms |
| keybindings loaded | 82 ms | 79 ms | 87 ms | 88 ms | 82 ms |
| session state loaded | 82 ms | 79 ms | 87 ms | 88 ms | 82 ms |
| extensions scanned | 77 ms | 76 ms | 82 ms | 85 ms | 77 ms |
| themes ready | 85 ms | 83 ms | 90 ms | 92 ms | 85 ms |
| DI container created | 89 ms | 88 ms | 94 ms | 96 ms | 89 ms |
| workbench mounted | 117 ms | 120 ms | 122 ms | 128 ms | 117 ms |
| first frame | 117 ms | 120 ms | 122 ms | 128 ms | 117 ms |
| workbench activated | 122 ms | 124 ms | 128 ms | 133 ms | 122 ms |
| grammars preloaded | 128 ms | 135 ms | 136 ms | 143 ms | 124 ms |
| file read from disk | 130 ms | 139 ms | 149 ms | 228 ms | 139 ms |
| file decoded | 130 ms | 139 ms | 149 ms | 228 ms | 139 ms |
| document built | 130 ms | 139 ms | 149 ms | 228 ms | 139 ms |
| tokenizer attached to editor | 151 ms | 160 ms | 172 ms | 252 ms | — |
| tabs opened | 134 ms | 145 ms | 159 ms | 237 ms | 159 ms |
| built-in extensions registered | 283 ms | 291 ms | 305 ms | 369 ms | 210 ms |
| frame with file text | 150 ms | 159 ms | 171 ms | 250 ms | 171 ms |
| frame with highlighting | 264 ms | 270 ms | 285 ms | 351 ms | — |
| extension host up | 507 ms | 535 ms | 611 ms | 923 ms | 376 ms |
| startup complete | 278 ms | 287 ms | 300 ms | 364 ms | 203 ms |
| to text (black box) | 151 ms | 161 ms | 172 ms | 251 ms | 174 ms |
| to highlight (black box) | 265 ms | 272 ms | 286 ms | 351 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 36 ms | 11 ms | 10 ms | 10 ms | 16 ms | 7 ms | 3 ms |
| `medium` | 34 ms | 12 ms | 10 ms | 8 ms | 13 ms | 7 ms | 6 ms |
| `large` | 35 ms | 18 ms | 14 ms | 14 ms | 42 ms | 13 ms | 17 ms |
| `xlarge` | 31 ms | 16 ms | 9 ms | 12 ms | 94 ms | 8 ms | 82 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
