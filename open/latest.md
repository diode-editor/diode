# File open benchmark

- Recorded: 2026-10-24T14:10:09.482Z, commit `12f31f84c2f6`, diode nightly-12f31f8
- Machine: AMD EPYC 9V45 96-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 19 ms; binary floor (`diode --version` over PTY, median): 43 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **90 ms** | 66 ms | 108 ms | 181 ms | 11 ms | 243 MB | 11 |
| `medium` | 126.7 KB | 2000 | **98 ms** | 74 ms | 117 ms | 198 ms | 13 ms | 246 MB | 11 |
| `large` | 1.3 MB | 20000 | **105 ms** | 81 ms | 123 ms | 199 ms | 17 ms | 288 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **166 ms** | 142 ms | 185 ms | 252 ms | 9 ms | 360 MB | 5 |
| `log500m` | 497 MB | 5295839 | **103 ms** | 79 ms | 122 ms | — (plaintext) | 4 ms | 308 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 6 ms | 7 ms | 8 ms | 6 ms |
| node ready (bootstrapComplete) | 47 ms | 50 ms | 54 ms | 57 ms | 48 ms |
| bundle executed (main:start) | 47 ms | 50 ms | 55 ms | 57 ms | 48 ms |
| config loaded | 59 ms | 64 ms | 68 ms | 76 ms | 62 ms |
| keybindings loaded | 61 ms | 64 ms | 68 ms | 76 ms | 64 ms |
| session state loaded | 61 ms | 64 ms | 68 ms | 77 ms | 64 ms |
| extensions scanned | 57 ms | 63 ms | 65 ms | 74 ms | 59 ms |
| themes ready | 63 ms | 67 ms | 70 ms | 80 ms | 66 ms |
| DI container created | 65 ms | 70 ms | 73 ms | 84 ms | 68 ms |
| workbench mounted | 84 ms | 89 ms | 90 ms | 105 ms | 85 ms |
| first frame | 84 ms | 89 ms | 90 ms | 105 ms | 85 ms |
| workbench activated | 87 ms | 92 ms | 93 ms | 108 ms | 88 ms |
| grammars preloaded | 91 ms | 98 ms | 101 ms | 116 ms | 89 ms |
| file read from disk | 92 ms | 101 ms | 108 ms | 167 ms | 97 ms |
| file decoded | 92 ms | 101 ms | 108 ms | 167 ms | 97 ms |
| document built | 92 ms | 101 ms | 108 ms | 167 ms | 97 ms |
| tokenizer attached to editor | 107 ms | 117 ms | 124 ms | 185 ms | — |
| tabs opened | 94 ms | 105 ms | 114 ms | 174 ms | 109 ms |
| built-in extensions registered | 196 ms | 215 ms | 213 ms | 267 ms | 142 ms |
| frame with file text | 106 ms | 115 ms | 122 ms | 183 ms | 118 ms |
| frame with highlighting | 180 ms | 198 ms | 199 ms | 252 ms | — |
| extension host up | 334 ms | 383 ms | 422 ms | 699 ms | 263 ms |
| startup complete | 192 ms | 210 ms | 210 ms | 264 ms | 139 ms |
| to text (black box) | 108 ms | 117 ms | 123 ms | 185 ms | 122 ms |
| to highlight (black box) | 181 ms | 198 ms | 199 ms | 252 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 1 ms | 2 ms | 2 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 12 ms | 7 ms | 6 ms | 3 ms | 8 ms | 2 ms | 2 ms |
| `medium` | 23 ms | 8 ms | 9 ms | 8 ms | 9 ms | 5 ms | 3 ms |
| `large` | 31 ms | 18 ms | 15 ms | 15 ms | 42 ms | 9 ms | 11 ms |
| `xlarge` | 20 ms | 26 ms | 11 ms | 14 ms | 120 ms | 11 ms | 43 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
