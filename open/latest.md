# File open benchmark

- Recorded: 2026-11-17T11:16:43.573Z, commit `9994bc0a977c`, diode nightly-9994bc0
- Machine: Intel(R) Xeon(R) 6975P-C (4 cores, 15 GB), linux 7.0.0-1016-aws
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 18 ms; binary floor (`diode --version` over PTY, median): 54 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **127 ms** | 91 ms | 145 ms | 228 ms | 6 ms | 277 MB | 11 |
| `medium` | 126.7 KB | 2000 | **128 ms** | 92 ms | 146 ms | 229 ms | 7 ms | 296 MB | 11 |
| `large` | 1.3 MB | 20000 | **133 ms** | 97 ms | 151 ms | 234 ms | 4 ms | 308 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **205 ms** | 169 ms | 223 ms | 295 ms | 2 ms | 363 MB | 5 |
| `log500m` | 497 MB | 5295839 | **136 ms** | 100 ms | 154 ms | — (plaintext) | 3 ms | 286 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 5 ms | 5 ms | 7 ms | 4 ms |
| node ready (bootstrapComplete) | 57 ms | 57 ms | 57 ms | 68 ms | 55 ms |
| bundle executed (main:start) | 57 ms | 57 ms | 57 ms | 68 ms | 55 ms |
| config loaded | 73 ms | 71 ms | 76 ms | 83 ms | 71 ms |
| keybindings loaded | 73 ms | 72 ms | 76 ms | 86 ms | 72 ms |
| session state loaded | 74 ms | 72 ms | 76 ms | 86 ms | 72 ms |
| extensions scanned | 69 ms | 69 ms | 71 ms | 79 ms | 68 ms |
| themes ready | 78 ms | 76 ms | 79 ms | 89 ms | 75 ms |
| DI container created | 80 ms | 79 ms | 83 ms | 91 ms | 78 ms |
| workbench mounted | 111 ms | 109 ms | 109 ms | 117 ms | 109 ms |
| first frame | 111 ms | 109 ms | 109 ms | 117 ms | 109 ms |
| workbench activated | 117 ms | 115 ms | 115 ms | 123 ms | 116 ms |
| grammars preloaded | 126 ms | 125 ms | 120 ms | 132 ms | 123 ms |
| file read from disk | 127 ms | 128 ms | 129 ms | 201 ms | 131 ms |
| file decoded | 127 ms | 128 ms | 129 ms | 201 ms | 131 ms |
| document built | 127 ms | 128 ms | 130 ms | 201 ms | 131 ms |
| tokenizer attached to editor | 143 ms | 145 ms | 149 ms | 222 ms | — |
| tabs opened | 131 ms | 133 ms | 136 ms | 209 ms | 142 ms |
| built-in extensions registered | 245 ms | 249 ms | 251 ms | 311 ms | 182 ms |
| frame with file text | 143 ms | 144 ms | 147 ms | 221 ms | 153 ms |
| frame with highlighting | 228 ms | 229 ms | 234 ms | 295 ms | — |
| extension host up | 430 ms | 442 ms | 522 ms | 870 ms | 330 ms |
| startup complete | 238 ms | 240 ms | 244 ms | 305 ms | 174 ms |
| to text (black box) | 145 ms | 146 ms | 151 ms | 223 ms | 154 ms |
| to highlight (black box) | 228 ms | 229 ms | 234 ms | 295 ms | — |
| gap black − white (text) | 2 ms | 1 ms | 2 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 21 ms | 10 ms | 8 ms | 6 ms | — | 4 ms | 3 ms |
| `medium` failed | 28 ms | 13 ms | 8 ms | 8 ms | — | 5 ms | 4 ms |
| `large` failed | 32 ms | 21 ms | 14 ms | 17 ms | — | 17 ms | 15 ms |
| `xlarge` failed | 26 ms | 30 ms | 21 ms | 29 ms | — | 13 ms | 69 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
