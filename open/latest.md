# File open benchmark

- Recorded: 2026-11-16T21:46:43.527Z, commit `970dae6b8f01`, diode nightly-970dae6
- Machine: Intel(R) Xeon(R) 6975P-C (4 cores, 15 GB), linux 7.0.0-1016-aws
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 16 ms; binary floor (`diode --version` over PTY, median): 50 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **119 ms** | 85 ms | 135 ms | 221 ms | 11 ms | 283 MB | 11 |
| `medium` | 126.7 KB | 2000 | **122 ms** | 88 ms | 138 ms | 221 ms | 4 ms | 293 MB | 11 |
| `large` | 1.3 MB | 20000 | **136 ms** | 102 ms | 152 ms | 233 ms | 3 ms | 307 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **206 ms** | 172 ms | 222 ms | 293 ms | 14 ms | 359 MB | 5 |
| `log500m` | 497 MB | 5295839 | **126 ms** | 92 ms | 142 ms | — (plaintext) | 2 ms | 285 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 4 ms | 7 ms | 6 ms | 4 ms |
| node ready (bootstrapComplete) | 54 ms | 54 ms | 59 ms | 66 ms | 53 ms |
| bundle executed (main:start) | 54 ms | 54 ms | 59 ms | 66 ms | 53 ms |
| config loaded | 69 ms | 67 ms | 74 ms | 82 ms | 65 ms |
| keybindings loaded | 70 ms | 67 ms | 76 ms | 82 ms | 65 ms |
| session state loaded | 70 ms | 68 ms | 76 ms | 82 ms | 66 ms |
| extensions scanned | 64 ms | 64 ms | 71 ms | 79 ms | 61 ms |
| themes ready | 73 ms | 71 ms | 80 ms | 86 ms | 69 ms |
| DI container created | 76 ms | 74 ms | 83 ms | 89 ms | 72 ms |
| workbench mounted | 104 ms | 104 ms | 109 ms | 119 ms | 103 ms |
| first frame | 104 ms | 104 ms | 109 ms | 119 ms | 103 ms |
| workbench activated | 110 ms | 110 ms | 115 ms | 125 ms | 108 ms |
| grammars preloaded | 118 ms | 117 ms | 123 ms | 134 ms | 112 ms |
| file read from disk | 120 ms | 120 ms | 133 ms | 203 ms | 119 ms |
| file decoded | 120 ms | 120 ms | 133 ms | 203 ms | 119 ms |
| document built | 120 ms | 120 ms | 134 ms | 203 ms | 120 ms |
| tokenizer attached to editor | 133 ms | 137 ms | 152 ms | 223 ms | — |
| tabs opened | 123 ms | 124 ms | 139 ms | 210 ms | 131 ms |
| built-in extensions registered | 236 ms | 238 ms | 252 ms | 309 ms | 172 ms |
| frame with file text | 133 ms | 135 ms | 150 ms | 221 ms | 142 ms |
| frame with highlighting | 220 ms | 221 ms | 233 ms | 293 ms | — |
| extension host up | 408 ms | 425 ms | 501 ms | 870 ms | 312 ms |
| startup complete | 230 ms | 232 ms | 244 ms | 302 ms | 163 ms |
| to text (black box) | 135 ms | 138 ms | 152 ms | 222 ms | 142 ms |
| to highlight (black box) | 221 ms | 221 ms | 233 ms | 293 ms | — |
| gap black − white (text) | 1 ms | 3 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 21 ms | 11 ms | 8 ms | 5 ms | — | 4 ms | 2 ms |
| `medium` failed | 26 ms | 11 ms | 8 ms | 6 ms | — | 6 ms | 4 ms |
| `large` failed | 30 ms | 25 ms | 18 ms | 18 ms | — | 12 ms | 14 ms |
| `xlarge` failed | 27 ms | 36 ms | 13 ms | 15 ms | — | 11 ms | 70 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
