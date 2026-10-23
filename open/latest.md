# File open benchmark

- Recorded: 2026-10-23T18:29:08.410Z, commit `73b94c8832c1`, diode nightly-73b94c8
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 60 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **136 ms** | 102 ms | 162 ms | 281 ms | 6 ms | 243 MB | 11 |
| `medium` | 126.7 KB | 2000 | **144 ms** | 110 ms | 169 ms | 289 ms | 8 ms | 244 MB | 11 |
| `large` | 1.3 MB | 20000 | **155 ms** | 120 ms | 180 ms | 297 ms | 3 ms | 286 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **240 ms** | 206 ms | 265 ms | 376 ms | 28 ms | 457 MB | 5 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` |
| --- | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 8 ms | 8 ms | 11 ms |
| node ready (bootstrapComplete) | 66 ms | 68 ms | 67 ms | 82 ms |
| bundle executed (main:start) | 66 ms | 68 ms | 67 ms | 82 ms |
| config loaded | 87 ms | 88 ms | 87 ms | 101 ms |
| keybindings loaded | 87 ms | 88 ms | 87 ms | 101 ms |
| session state loaded | 87 ms | 88 ms | 87 ms | 101 ms |
| extensions scanned | 82 ms | 84 ms | 84 ms | 98 ms |
| themes ready | 90 ms | 92 ms | 91 ms | 105 ms |
| DI container created | 95 ms | 96 ms | 96 ms | 110 ms |
| workbench mounted | 125 ms | 131 ms | 128 ms | 139 ms |
| first frame | 125 ms | 130 ms | 128 ms | 139 ms |
| workbench activated | 130 ms | 136 ms | 134 ms | 146 ms |
| grammars preloaded | 141 ms | 145 ms | 144 ms | 151 ms |
| file read from disk | 142 ms | 148 ms | 156 ms | 238 ms |
| file decoded | 142 ms | 148 ms | 156 ms | 238 ms |
| document built | 142 ms | 148 ms | 156 ms | 239 ms |
| tokenizer attached to editor | 162 ms | 170 ms | 180 ms | 267 ms |
| tabs opened | 146 ms | 155 ms | 164 ms | 248 ms |
| built-in extensions registered | 302 ms | 310 ms | 319 ms | 395 ms |
| frame with file text | 161 ms | 168 ms | 178 ms | 265 ms |
| frame with highlighting | 281 ms | 288 ms | 297 ms | 376 ms |
| extension host up | 539 ms | 565 ms | 621 ms | 1079 ms |
| startup complete | 297 ms | 304 ms | 314 ms | 390 ms |
| to text (black box) | 162 ms | 169 ms | 180 ms | 265 ms |
| to highlight (black box) | 281 ms | 289 ms | 297 ms | 376 ms |
| gap black − white (text) | 1 ms | 1 ms | 2 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 39 ms | 10 ms | 10 ms | 12 ms | 15 ms | 6 ms | 4 ms |
| `medium` | 41 ms | 12 ms | 11 ms | 11 ms | 13 ms | 6 ms | 10 ms |
| `large` | 39 ms | 20 ms | 16 ms | 17 ms | 47 ms | 16 ms | 16 ms |
| `xlarge` | 54 ms | 25 ms | 14 ms | 17 ms | 114 ms | 11 ms | 86 ms |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
