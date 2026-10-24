# File open benchmark

- Recorded: 2026-10-24T08:40:21.804Z, commit `f4956a2e17ea`, diode nightly-f4956a2
- Machine: INTEL(R) XEON(R) PLATINUM 8573C (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 20 ms; binary floor (`diode --version` over PTY, median): 49 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **107 ms** | 78 ms | 127 ms | 227 ms | 4 ms | 242 MB | 11 |
| `medium` | 126.7 KB | 2000 | **112 ms** | 83 ms | 132 ms | 231 ms | 4 ms | 245 MB | 11 |
| `large` | 1.3 MB | 20000 | **121 ms** | 92 ms | 142 ms | 241 ms | 7 ms | 288 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **209 ms** | 180 ms | 229 ms | 321 ms | 23 ms | 466 MB | 5 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` |
| --- | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 5 ms | 6 ms | 6 ms |
| node ready (bootstrapComplete) | 54 ms | 53 ms | 54 ms | 62 ms |
| bundle executed (main:start) | 54 ms | 53 ms | 54 ms | 62 ms |
| config loaded | 68 ms | 68 ms | 68 ms | 80 ms |
| keybindings loaded | 68 ms | 69 ms | 68 ms | 80 ms |
| session state loaded | 68 ms | 69 ms | 68 ms | 80 ms |
| extensions scanned | 64 ms | 66 ms | 65 ms | 77 ms |
| themes ready | 72 ms | 72 ms | 72 ms | 84 ms |
| DI container created | 75 ms | 76 ms | 76 ms | 89 ms |
| workbench mounted | 98 ms | 100 ms | 99 ms | 112 ms |
| first frame | 98 ms | 100 ms | 99 ms | 112 ms |
| workbench activated | 102 ms | 104 ms | 103 ms | 116 ms |
| grammars preloaded | 111 ms | 112 ms | 109 ms | 121 ms |
| file read from disk | 112 ms | 114 ms | 119 ms | 209 ms |
| file decoded | 112 ms | 114 ms | 119 ms | 209 ms |
| document built | 112 ms | 115 ms | 119 ms | 209 ms |
| tokenizer attached to editor | 127 ms | 132 ms | 141 ms | 230 ms |
| tabs opened | 115 ms | 120 ms | 126 ms | 217 ms |
| built-in extensions registered | 240 ms | 244 ms | 255 ms | 335 ms |
| frame with file text | 126 ms | 130 ms | 139 ms | 229 ms |
| frame with highlighting | 226 ms | 231 ms | 241 ms | 320 ms |
| extension host up | 415 ms | 432 ms | 502 ms | 906 ms |
| startup complete | 236 ms | 241 ms | 252 ms | 330 ms |
| to text (black box) | 127 ms | 132 ms | 142 ms | 229 ms |
| to highlight (black box) | 227 ms | 231 ms | 241 ms | 321 ms |
| gap black − white (text) | 1 ms | 1 ms | 2 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 33 ms | 7 ms | 8 ms | 7 ms | 12 ms | 4 ms | 2 ms |
| `medium` | 26 ms | 9 ms | 8 ms | 7 ms | 11 ms | 6 ms | 3 ms |
| `large` | 31 ms | 20 ms | 13 ms | 17 ms | 46 ms | 9 ms | 15 ms |
| `xlarge` | 36 ms | 21 ms | 14 ms | 16 ms | 102 ms | 9 ms | 61 ms |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
