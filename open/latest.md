# File open benchmark

- Recorded: 2026-11-17T01:06:11.543Z, commit `3142fef8844d`, diode nightly-3142fef
- Machine: Intel(R) Xeon(R) 6973P-C (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 18 ms; binary floor (`diode --version` over PTY, median): 53 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **120 ms** | 86 ms | 138 ms | 221 ms | 7 ms | 278 MB | 11 |
| `medium` | 126.7 KB | 2000 | **119 ms** | 85 ms | 137 ms | 214 ms | 8 ms | 292 MB | 11 |
| `large` | 1.3 MB | 20000 | **130 ms** | 96 ms | 148 ms | 227 ms | 7 ms | 306 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **191 ms** | 157 ms | 209 ms | 279 ms | 5 ms | 363 MB | 5 |
| `log500m` | 497 MB | 5295839 | **123 ms** | 89 ms | 142 ms | — (plaintext) | 4 ms | 321 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 5 ms | 7 ms | 6 ms | 5 ms |
| node ready (bootstrapComplete) | 58 ms | 56 ms | 61 ms | 65 ms | 52 ms |
| bundle executed (main:start) | 58 ms | 56 ms | 61 ms | 66 ms | 52 ms |
| config loaded | 71 ms | 68 ms | 76 ms | 82 ms | 66 ms |
| keybindings loaded | 71 ms | 70 ms | 77 ms | 82 ms | 68 ms |
| session state loaded | 71 ms | 70 ms | 77 ms | 82 ms | 68 ms |
| extensions scanned | 66 ms | 65 ms | 73 ms | 78 ms | 63 ms |
| themes ready | 75 ms | 73 ms | 79 ms | 87 ms | 71 ms |
| DI container created | 78 ms | 76 ms | 82 ms | 90 ms | 74 ms |
| workbench mounted | 107 ms | 105 ms | 108 ms | 117 ms | 103 ms |
| first frame | 107 ms | 105 ms | 108 ms | 117 ms | 103 ms |
| workbench activated | 113 ms | 111 ms | 113 ms | 122 ms | 108 ms |
| grammars preloaded | 121 ms | 116 ms | 120 ms | 126 ms | 111 ms |
| file read from disk | 123 ms | 119 ms | 129 ms | 188 ms | 118 ms |
| file decoded | 123 ms | 119 ms | 129 ms | 188 ms | 118 ms |
| document built | 123 ms | 119 ms | 129 ms | 188 ms | 118 ms |
| tokenizer attached to editor | 137 ms | 138 ms | 148 ms | 208 ms | — |
| tabs opened | 126 ms | 123 ms | 135 ms | 195 ms | 129 ms |
| built-in extensions registered | 238 ms | 232 ms | 246 ms | 297 ms | 171 ms |
| frame with file text | 137 ms | 136 ms | 146 ms | 206 ms | 140 ms |
| frame with highlighting | 220 ms | 214 ms | 226 ms | 279 ms | — |
| extension host up | 408 ms | 411 ms | 494 ms | 845 ms | 304 ms |
| startup complete | 232 ms | 225 ms | 238 ms | 289 ms | 162 ms |
| to text (black box) | 138 ms | 137 ms | 148 ms | 209 ms | 142 ms |
| to highlight (black box) | 221 ms | 214 ms | 227 ms | 279 ms | — |
| gap black − white (text) | 2 ms | 1 ms | 1 ms | 2 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 12 ms | 7 ms | 5 ms | 6 ms | — | 4 ms | 2 ms |
| `medium` failed | 23 ms | 13 ms | 8 ms | 7 ms | — | 6 ms | 4 ms |
| `large` failed | 31 ms | 27 ms | 19 ms | 22 ms | — | 8 ms | 15 ms |
| `xlarge` failed | 28 ms | 30 ms | 20 ms | 17 ms | — | 10 ms | 57 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
