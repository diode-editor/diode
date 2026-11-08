# File open benchmark

- Recorded: 2026-11-08T21:55:22.350Z, commit `41b05acb2eeb`, diode nightly-41b05ac
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 20 ms; binary floor (`diode --version` over PTY, median): 55 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **129 ms** | 95 ms | 149 ms | 240 ms | 3 ms | 263 MB | 11 |
| `medium` | 126.7 KB | 2000 | **131 ms** | 96 ms | 151 ms | 242 ms | 5 ms | 287 MB | 11 |
| `large` | 1.3 MB | 20000 | **145 ms** | 110 ms | 165 ms | 254 ms | 11 ms | 300 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **219 ms** | 184 ms | 239 ms | 314 ms | 10 ms | 352 MB | 5 |
| `log500m` | 497 MB | 5295839 | **139 ms** | 104 ms | 159 ms | — (plaintext) | 2 ms | 279 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 6 ms | 8 ms | 5 ms |
| node ready (bootstrapComplete) | 60 ms | 61 ms | 72 ms | 79 ms | 56 ms |
| bundle executed (main:start) | 60 ms | 61 ms | 72 ms | 79 ms | 56 ms |
| config loaded | 74 ms | 75 ms | 86 ms | 95 ms | 70 ms |
| keybindings loaded | 74 ms | 76 ms | 86 ms | 95 ms | 70 ms |
| session state loaded | 74 ms | 76 ms | 87 ms | 95 ms | 70 ms |
| extensions scanned | 70 ms | 71 ms | 83 ms | 91 ms | 67 ms |
| themes ready | 80 ms | 80 ms | 91 ms | 99 ms | 74 ms |
| DI container created | 83 ms | 83 ms | 95 ms | 102 ms | 78 ms |
| workbench mounted | 114 ms | 115 ms | 123 ms | 133 ms | 110 ms |
| first frame | 114 ms | 115 ms | 123 ms | 133 ms | 110 ms |
| workbench activated | 121 ms | 121 ms | 128 ms | 139 ms | 116 ms |
| grammars preloaded | 130 ms | 130 ms | 133 ms | 144 ms | 122 ms |
| file read from disk | 132 ms | 133 ms | 144 ms | 213 ms | 132 ms |
| file decoded | 132 ms | 133 ms | 144 ms | 213 ms | 132 ms |
| document built | 132 ms | 133 ms | 144 ms | 214 ms | 132 ms |
| tokenizer attached to editor | 148 ms | 151 ms | 164 ms | 239 ms | — |
| tabs opened | 136 ms | 138 ms | 152 ms | 222 ms | 147 ms |
| built-in extensions registered | 260 ms | 264 ms | 277 ms | 336 ms | 193 ms |
| frame with file text | 148 ms | 150 ms | 163 ms | 237 ms | 159 ms |
| frame with highlighting | 239 ms | 242 ms | 254 ms | 314 ms | — |
| extension host up | 456 ms | 495 ms | 561 ms | 931 ms | 352 ms |
| startup complete | 254 ms | 256 ms | 269 ms | 328 ms | 185 ms |
| to text (black box) | 149 ms | 151 ms | 165 ms | 239 ms | 159 ms |
| to highlight (black box) | 240 ms | 242 ms | 254 ms | 314 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 1 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 28 ms | 11 ms | 9 ms | 8 ms | — | 5 ms | 3 ms |
| `medium` failed | 29 ms | 13 ms | 10 ms | 10 ms | — | 5 ms | 4 ms |
| `large` failed | 29 ms | 23 ms | 16 ms | 15 ms | — | 15 ms | 14 ms |
| `xlarge` failed | 32 ms | 23 ms | 18 ms | 29 ms | — | 23 ms | 73 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
