# File open benchmark

- Recorded: 2026-11-19T09:58:51.640Z, commit `a1a666551406`, diode nightly-a1a6665
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1020-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 21 ms; binary floor (`diode --version` over PTY, median): 62 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **139 ms** | 98 ms | 160 ms | 254 ms | 10 ms | 293 MB | 11 |
| `medium` | 126.7 KB | 2000 | **143 ms** | 102 ms | 164 ms | 253 ms | 10 ms | 301 MB | 11 |
| `large` | 1.3 MB | 20000 | **148 ms** | 107 ms | 169 ms | 260 ms | 13 ms | 312 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **234 ms** | 193 ms | 255 ms | 328 ms | 6 ms | 363 MB | 5 |
| `log500m` | 497 MB | 5295839 | **148 ms** | 107 ms | 169 ms | — (plaintext) | 5 ms | 326 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 6 ms | 9 ms | 5 ms |
| node ready (bootstrapComplete) | 67 ms | 66 ms | 67 ms | 83 ms | 61 ms |
| bundle executed (main:start) | 67 ms | 66 ms | 67 ms | 83 ms | 61 ms |
| config loaded | 85 ms | 85 ms | 88 ms | 100 ms | 81 ms |
| keybindings loaded | 86 ms | 85 ms | 88 ms | 100 ms | 81 ms |
| session state loaded | 86 ms | 85 ms | 88 ms | 100 ms | 81 ms |
| extensions scanned | 79 ms | 79 ms | 80 ms | 94 ms | 77 ms |
| themes ready | 91 ms | 89 ms | 92 ms | 106 ms | 84 ms |
| DI container created | 94 ms | 93 ms | 94 ms | 109 ms | 87 ms |
| workbench mounted | 127 ms | 126 ms | 126 ms | 142 ms | 122 ms |
| first frame | 127 ms | 126 ms | 126 ms | 142 ms | 122 ms |
| workbench activated | 133 ms | 134 ms | 135 ms | 150 ms | 128 ms |
| grammars preloaded | 137 ms | 138 ms | 139 ms | 154 ms | 130 ms |
| file read from disk | 139 ms | 142 ms | 148 ms | 231 ms | 138 ms |
| file decoded | 139 ms | 142 ms | 148 ms | 231 ms | 138 ms |
| document built | 139 ms | 142 ms | 148 ms | 231 ms | 138 ms |
| tokenizer attached to editor | 158 ms | 163 ms | 169 ms | 254 ms | — |
| tabs opened | 144 ms | 147 ms | 155 ms | 240 ms | 156 ms |
| built-in extensions registered | 280 ms | 278 ms | 286 ms | 354 ms | 208 ms |
| frame with file text | 158 ms | 162 ms | 167 ms | 253 ms | 168 ms |
| frame with highlighting | 254 ms | 250 ms | 260 ms | 328 ms | — |
| extension host up | 477 ms | 521 ms | 577 ms | 945 ms | 360 ms |
| startup complete | 271 ms | 267 ms | 277 ms | 345 ms | 197 ms |
| to text (black box) | 160 ms | 164 ms | 169 ms | 255 ms | 169 ms |
| to highlight (black box) | 254 ms | 253 ms | 260 ms | 328 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 3 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 32 ms | 13 ms | 10 ms | 10 ms | — | 5 ms | 3 ms |
| `medium` failed | 28 ms | 14 ms | 9 ms | 10 ms | — | 6 ms | 4 ms |
| `large` failed | 41 ms | 26 ms | 22 ms | 22 ms | — | 12 ms | 14 ms |
| `xlarge` failed | 40 ms | 32 ms | 12 ms | 18 ms | — | 11 ms | 75 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
