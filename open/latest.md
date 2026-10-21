# File open benchmark

- Recorded: 2026-10-21T19:19:07.156Z, commit `a66c0f248e9d`, diode nightly-a66c0f2
- Machine: AMD EPYC 9V45 96-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 21 ms; binary floor (`diode --version` over PTY, median): 46 ms; for reference `node --version`: 5 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **104 ms** | 79 ms | 125 ms | 203 ms | 14 ms | 244 MB | 11 |
| `medium` | 126.7 KB | 2000 | **123 ms** | 98 ms | 144 ms | 229 ms | 6 ms | 254 MB | 11 |
| `large` | 1.3 MB | 20000 | **224 ms** | 198 ms | 245 ms | 317 ms | 3 ms | 302 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **1067 ms** | 1042 ms | 1088 ms | 1210 ms | 14 ms | 505 MB | 5 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` |
| --- | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 6 ms | 7 ms | 8 ms |
| node ready (bootstrapComplete) | 54 ms | 53 ms | 57 ms | 68 ms |
| bundle executed (main:start) | 54 ms | 53 ms | 57 ms | 68 ms |
| config loaded | 67 ms | 67 ms | 69 ms | 91 ms |
| keybindings loaded | 67 ms | 67 ms | 69 ms | 94 ms |
| session state loaded | 67 ms | 68 ms | 70 ms | 94 ms |
| extensions scanned | 65 ms | 65 ms | 66 ms | 87 ms |
| themes ready | 70 ms | 70 ms | 72 ms | 97 ms |
| DI container created | 73 ms | 73 ms | 75 ms | 101 ms |
| workbench mounted | 95 ms | 93 ms | 97 ms | 122 ms |
| first frame | 95 ms | 93 ms | 97 ms | 122 ms |
| workbench activated | 100 ms | 96 ms | 101 ms | 126 ms |
| grammars preloaded | 108 ms | 103 ms | 110 ms | 131 ms |
| file read from disk | 109 ms | 105 ms | 117 ms | 188 ms |
| file decoded | 109 ms | 105 ms | 117 ms | 188 ms |
| document built | 109 ms | 105 ms | 117 ms | 188 ms |
| tokenizer attached to editor | 125 ms | 144 ms | 246 ms | 1089 ms |
| tabs opened | 112 ms | 112 ms | 130 ms | 216 ms |
| built-in extensions registered | 221 ms | 243 ms | 331 ms | 1224 ms |
| frame with file text | 124 ms | 143 ms | 244 ms | 1088 ms |
| frame with highlighting | 203 ms | 229 ms | 317 ms | 1210 ms |
| extension host up | 391 ms | 427 ms | 546 ms | 1664 ms |
| startup complete | 216 ms | 239 ms | 328 ms | 1220 ms |
| to text (black box) | 125 ms | 144 ms | 245 ms | 1088 ms |
| to highlight (black box) | 203 ms | 229 ms | 317 ms | 1210 ms |
| gap black − white (text) | 2 ms | 2 ms | 0 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 28 ms | 12 ms | 10 ms | 8 ms | 13 ms | 6 ms | 2 ms |
| `medium` | 29 ms | 15 ms | 11 ms | 12 ms | 16 ms | 5 ms | 3 ms |
| `large` | 51 ms | 39 ms | 29 ms | 40 ms | 48 ms | 11 ms | 9 ms |
| `xlarge` | 156 ms | 173 ms | 236 ms | 204 ms | 243 ms | 9 ms | 40 ms |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
