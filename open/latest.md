# File open benchmark

- Recorded: 2026-11-19T13:13:28.943Z, commit `ce1cd8be0b20`, diode nightly-ce1cd8b
- Machine: Intel(R) Xeon(R) 6973P-C (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 19 ms; binary floor (`diode --version` over PTY, median): 58 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **130 ms** | 90 ms | 149 ms | 230 ms | 6 ms | 294 MB | 11 |
| `medium` | 126.7 KB | 2000 | **133 ms** | 93 ms | 151 ms | 237 ms | 9 ms | 301 MB | 11 |
| `large` | 1.3 MB | 20000 | **146 ms** | 107 ms | 165 ms | 251 ms | 9 ms | 312 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **201 ms** | 161 ms | 219 ms | 292 ms | 6 ms | 368 MB | 5 |
| `log500m` | 497 MB | 5295839 | **140 ms** | 100 ms | 159 ms | — (plaintext) | 7 ms | 343 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 5 ms | 7 ms | 7 ms | 5 ms |
| node ready (bootstrapComplete) | 61 ms | 62 ms | 68 ms | 69 ms | 58 ms |
| bundle executed (main:start) | 61 ms | 62 ms | 68 ms | 69 ms | 58 ms |
| config loaded | 82 ms | 77 ms | 84 ms | 88 ms | 73 ms |
| keybindings loaded | 82 ms | 77 ms | 84 ms | 88 ms | 75 ms |
| session state loaded | 82 ms | 77 ms | 84 ms | 88 ms | 75 ms |
| extensions scanned | 76 ms | 73 ms | 78 ms | 80 ms | 70 ms |
| themes ready | 85 ms | 81 ms | 87 ms | 91 ms | 78 ms |
| DI container created | 87 ms | 84 ms | 89 ms | 93 ms | 80 ms |
| workbench mounted | 116 ms | 115 ms | 121 ms | 122 ms | 113 ms |
| first frame | 116 ms | 115 ms | 121 ms | 122 ms | 113 ms |
| workbench activated | 122 ms | 122 ms | 125 ms | 129 ms | 120 ms |
| grammars preloaded | 128 ms | 131 ms | 132 ms | 137 ms | 127 ms |
| file read from disk | 130 ms | 133 ms | 144 ms | 197 ms | 135 ms |
| file decoded | 130 ms | 133 ms | 145 ms | 197 ms | 135 ms |
| document built | 131 ms | 134 ms | 145 ms | 197 ms | 135 ms |
| tokenizer attached to editor | 148 ms | 151 ms | 165 ms | 220 ms | — |
| tabs opened | 134 ms | 138 ms | 151 ms | 204 ms | 148 ms |
| built-in extensions registered | 257 ms | 264 ms | 275 ms | 315 ms | 196 ms |
| frame with file text | 148 ms | 149 ms | 164 ms | 218 ms | 158 ms |
| frame with highlighting | 230 ms | 237 ms | 251 ms | 291 ms | — |
| extension host up | 434 ms | 457 ms | 540 ms | 896 ms | 342 ms |
| startup complete | 244 ms | 253 ms | 265 ms | 305 ms | 184 ms |
| to text (black box) | 149 ms | 151 ms | 165 ms | 219 ms | 159 ms |
| to highlight (black box) | 230 ms | 237 ms | 251 ms | 292 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 1 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 24 ms | 12 ms | 11 ms | 7 ms | — | 4 ms | 3 ms |
| `medium` failed | 28 ms | 12 ms | 9 ms | 11 ms | — | 4 ms | 5 ms |
| `large` failed | 43 ms | 22 ms | 26 ms | 21 ms | — | 14 ms | 16 ms |
| `xlarge` failed | 28 ms | 23 ms | 15 ms | 13 ms | — | 14 ms | 62 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
