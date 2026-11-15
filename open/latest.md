# File open benchmark

- Recorded: 2026-11-15T07:15:04.175Z, commit `b351b68c7576`, diode nightly-b351b68
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 20 ms; binary floor (`diode --version` over PTY, median): 58 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **126 ms** | 88 ms | 146 ms | 234 ms | 5 ms | 281 MB | 11 |
| `medium` | 126.7 KB | 2000 | **131 ms** | 92 ms | 150 ms | 239 ms | 5 ms | 290 MB | 11 |
| `large` | 1.3 MB | 20000 | **150 ms** | 111 ms | 170 ms | 258 ms | 9 ms | 303 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **222 ms** | 184 ms | 242 ms | 315 ms | 20 ms | 358 MB | 5 |
| `log500m` | 497 MB | 5295839 | **138 ms** | 99 ms | 158 ms | — (plaintext) | 3 ms | 317 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 6 ms | 7 ms | 9 ms | 5 ms |
| node ready (bootstrapComplete) | 63 ms | 64 ms | 67 ms | 78 ms | 59 ms |
| bundle executed (main:start) | 63 ms | 64 ms | 67 ms | 78 ms | 59 ms |
| config loaded | 80 ms | 80 ms | 84 ms | 94 ms | 77 ms |
| keybindings loaded | 80 ms | 80 ms | 84 ms | 95 ms | 77 ms |
| session state loaded | 80 ms | 80 ms | 84 ms | 95 ms | 77 ms |
| extensions scanned | 75 ms | 75 ms | 81 ms | 88 ms | 75 ms |
| themes ready | 83 ms | 87 ms | 89 ms | 98 ms | 81 ms |
| DI container created | 86 ms | 90 ms | 92 ms | 100 ms | 84 ms |
| workbench mounted | 116 ms | 117 ms | 125 ms | 130 ms | 111 ms |
| first frame | 116 ms | 117 ms | 125 ms | 130 ms | 111 ms |
| workbench activated | 122 ms | 124 ms | 133 ms | 136 ms | 117 ms |
| grammars preloaded | 126 ms | 128 ms | 139 ms | 145 ms | 118 ms |
| file read from disk | 128 ms | 130 ms | 150 ms | 220 ms | 127 ms |
| file decoded | 128 ms | 130 ms | 150 ms | 220 ms | 127 ms |
| document built | 128 ms | 130 ms | 150 ms | 220 ms | 127 ms |
| tokenizer attached to editor | 146 ms | 150 ms | 171 ms | 242 ms | — |
| tabs opened | 131 ms | 135 ms | 157 ms | 228 ms | 142 ms |
| built-in extensions registered | 258 ms | 263 ms | 282 ms | 344 ms | 196 ms |
| frame with file text | 146 ms | 148 ms | 169 ms | 240 ms | 156 ms |
| frame with highlighting | 234 ms | 239 ms | 258 ms | 315 ms | — |
| extension host up | 445 ms | 492 ms | 572 ms | 950 ms | 362 ms |
| startup complete | 251 ms | 255 ms | 274 ms | 335 ms | 188 ms |
| to text (black box) | 146 ms | 150 ms | 170 ms | 242 ms | 158 ms |
| to highlight (black box) | 234 ms | 239 ms | 258 ms | 315 ms | — |
| gap black − white (text) | 0 ms | 2 ms | 1 ms | 2 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 31 ms | 12 ms | 10 ms | 9 ms | — | 5 ms | 3 ms |
| `medium` failed | 25 ms | 12 ms | 9 ms | 8 ms | — | 5 ms | 4 ms |
| `large` failed | 34 ms | 22 ms | 16 ms | 20 ms | — | 19 ms | 14 ms |
| `xlarge` failed | 25 ms | 37 ms | 23 ms | 42 ms | — | 20 ms | 65 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
