# File open benchmark

- Recorded: 2026-11-26T08:57:38.661Z, commit `96c6d1ac16fe`, diode nightly-96c6d1a
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1020-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 21 ms; binary floor (`diode --version` over PTY, median): 61 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **143 ms** | 103 ms | 164 ms | 253 ms | 11 ms | 296 MB | 11 |
| `medium` | 126.7 KB | 2000 | **145 ms** | 104 ms | 166 ms | 256 ms | 7 ms | 302 MB | 11 |
| `large` | 1.3 MB | 20000 | **160 ms** | 119 ms | 181 ms | 268 ms | 12 ms | 315 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **227 ms** | 186 ms | 248 ms | 325 ms | 14 ms | 367 MB | 5 |
| `log500m` | 497 MB | 5295839 | **150 ms** | 109 ms | 171 ms | — (plaintext) | 1 ms | 340 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 6 ms | 14 ms | 5 ms |
| node ready (bootstrapComplete) | 67 ms | 68 ms | 71 ms | 87 ms | 63 ms |
| bundle executed (main:start) | 67 ms | 68 ms | 71 ms | 87 ms | 63 ms |
| config loaded | 88 ms | 91 ms | 91 ms | 109 ms | 84 ms |
| keybindings loaded | 90 ms | 91 ms | 92 ms | 109 ms | 84 ms |
| session state loaded | 90 ms | 91 ms | 92 ms | 109 ms | 84 ms |
| extensions scanned | 82 ms | 84 ms | 86 ms | 103 ms | 81 ms |
| themes ready | 94 ms | 94 ms | 96 ms | 112 ms | 87 ms |
| DI container created | 96 ms | 97 ms | 99 ms | 115 ms | 90 ms |
| workbench mounted | 132 ms | 131 ms | 133 ms | 149 ms | 125 ms |
| first frame | 132 ms | 131 ms | 133 ms | 149 ms | 125 ms |
| workbench activated | 138 ms | 137 ms | 139 ms | 158 ms | 130 ms |
| grammars preloaded | 142 ms | 141 ms | 143 ms | 163 ms | 132 ms |
| file read from disk | 145 ms | 145 ms | 156 ms | 226 ms | 141 ms |
| file decoded | 145 ms | 145 ms | 156 ms | 227 ms | 141 ms |
| document built | 146 ms | 145 ms | 156 ms | 227 ms | 141 ms |
| tokenizer attached to editor | 164 ms | 168 ms | 179 ms | 250 ms | — |
| tabs opened | 149 ms | 151 ms | 163 ms | 236 ms | 155 ms |
| built-in extensions registered | 281 ms | 283 ms | 295 ms | 351 ms | 209 ms |
| frame with file text | 163 ms | 165 ms | 177 ms | 247 ms | 169 ms |
| frame with highlighting | 253 ms | 256 ms | 268 ms | 325 ms | — |
| extension host up | 483 ms | 526 ms | 579 ms | 954 ms | 358 ms |
| startup complete | 271 ms | 274 ms | 286 ms | 341 ms | 198 ms |
| to text (black box) | 164 ms | 166 ms | 181 ms | 248 ms | 171 ms |
| to highlight (black box) | 253 ms | 256 ms | 268 ms | 325 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 2 ms | 0 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 27 ms | 12 ms | 11 ms | 8 ms | — | 6 ms | 3 ms |
| `medium` failed | 27 ms | 16 ms | 9 ms | 9 ms | — | 5 ms | 5 ms |
| `large` failed | 32 ms | 24 ms | 18 ms | 16 ms | — | 12 ms | 15 ms |
| `xlarge` failed | 32 ms | 37 ms | 16 ms | 19 ms | — | 10 ms | 60 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
