# File open benchmark

- Recorded: 2026-11-18T23:45:02.120Z, commit `1ae2852cadac`, diode nightly-1ae2852
- Machine: Intel(R) Xeon(R) 6975P-C (4 cores, 15 GB), linux 7.0.0-1016-aws
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 17 ms; binary floor (`diode --version` over PTY, median): 53 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **128 ms** | 91 ms | 144 ms | 224 ms | 14 ms | 283 MB | 11 |
| `medium` | 126.7 KB | 2000 | **125 ms** | 88 ms | 141 ms | 223 ms | 4 ms | 302 MB | 11 |
| `large` | 1.3 MB | 20000 | **137 ms** | 100 ms | 154 ms | 233 ms | 2 ms | 314 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **198 ms** | 161 ms | 215 ms | 285 ms | 8 ms | 365 MB | 5 |
| `log500m` | 497 MB | 5295839 | **129 ms** | 92 ms | 146 ms | — (plaintext) | 3 ms | 350 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 5 ms | 6 ms | 8 ms | 4 ms |
| node ready (bootstrapComplete) | 56 ms | 56 ms | 59 ms | 68 ms | 54 ms |
| bundle executed (main:start) | 56 ms | 56 ms | 59 ms | 69 ms | 54 ms |
| config loaded | 74 ms | 70 ms | 72 ms | 83 ms | 73 ms |
| keybindings loaded | 74 ms | 72 ms | 73 ms | 85 ms | 74 ms |
| session state loaded | 74 ms | 73 ms | 73 ms | 85 ms | 74 ms |
| extensions scanned | 69 ms | 67 ms | 69 ms | 80 ms | 68 ms |
| themes ready | 78 ms | 76 ms | 77 ms | 88 ms | 77 ms |
| DI container created | 81 ms | 78 ms | 80 ms | 90 ms | 79 ms |
| workbench mounted | 110 ms | 108 ms | 110 ms | 120 ms | 106 ms |
| first frame | 110 ms | 108 ms | 110 ms | 120 ms | 106 ms |
| workbench activated | 117 ms | 114 ms | 116 ms | 125 ms | 110 ms |
| grammars preloaded | 125 ms | 121 ms | 125 ms | 129 ms | 112 ms |
| file read from disk | 128 ms | 124 ms | 136 ms | 193 ms | 120 ms |
| file decoded | 128 ms | 124 ms | 136 ms | 193 ms | 120 ms |
| document built | 128 ms | 124 ms | 136 ms | 193 ms | 120 ms |
| tokenizer attached to editor | 141 ms | 141 ms | 154 ms | 216 ms | — |
| tabs opened | 131 ms | 128 ms | 142 ms | 200 ms | 132 ms |
| built-in extensions registered | 246 ms | 246 ms | 255 ms | 304 ms | 175 ms |
| frame with file text | 141 ms | 139 ms | 153 ms | 214 ms | 143 ms |
| frame with highlighting | 224 ms | 223 ms | 233 ms | 285 ms | — |
| extension host up | 426 ms | 440 ms | 517 ms | 872 ms | 317 ms |
| startup complete | 237 ms | 236 ms | 246 ms | 296 ms | 166 ms |
| to text (black box) | 144 ms | 141 ms | 154 ms | 215 ms | 146 ms |
| to highlight (black box) | 224 ms | 223 ms | 233 ms | 285 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 1 ms | 2 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 25 ms | 10 ms | 8 ms | 6 ms | — | 3 ms | 3 ms |
| `medium` failed | 24 ms | 11 ms | 9 ms | 10 ms | — | 4 ms | 4 ms |
| `large` failed | 32 ms | 24 ms | 18 ms | 13 ms | — | 14 ms | 14 ms |
| `xlarge` failed | 37 ms | 31 ms | 21 ms | 22 ms | — | 12 ms | 57 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
