# File open benchmark

- Recorded: 2026-11-01T10:46:27.697Z, commit `decb220b1b21`, diode nightly-decb220
- Machine: INTEL(R) XEON(R) PLATINUM 8573C (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 24 ms; binary floor (`diode --version` over PTY, median): 62 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **135 ms** | 96 ms | 158 ms | 279 ms | 10 ms | 256 MB | 11 |
| `medium` | 126.7 KB | 2000 | **142 ms** | 103 ms | 165 ms | 282 ms | 4 ms | 282 MB | 11 |
| `large` | 1.3 MB | 20000 | **155 ms** | 116 ms | 179 ms | 314 ms | 8 ms | 301 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **250 ms** | 211 ms | 274 ms | 403 ms | 4 ms | 367 MB | 5 |
| `log500m` | 497 MB | 5295839 | **142 ms** | 103 ms | 166 ms | — (plaintext) | 3 ms | 306 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 6 ms | 7 ms | 5 ms |
| node ready (bootstrapComplete) | 65 ms | 66 ms | 65 ms | 77 ms | 62 ms |
| bundle executed (main:start) | 65 ms | 66 ms | 65 ms | 77 ms | 62 ms |
| config loaded | 84 ms | 84 ms | 79 ms | 93 ms | 82 ms |
| keybindings loaded | 86 ms | 84 ms | 80 ms | 93 ms | 84 ms |
| session state loaded | 87 ms | 84 ms | 80 ms | 94 ms | 84 ms |
| extensions scanned | 80 ms | 80 ms | 76 ms | 91 ms | 78 ms |
| themes ready | 90 ms | 89 ms | 85 ms | 98 ms | 87 ms |
| DI container created | 93 ms | 93 ms | 89 ms | 102 ms | 90 ms |
| workbench mounted | 122 ms | 124 ms | 121 ms | 134 ms | 118 ms |
| first frame | 122 ms | 124 ms | 121 ms | 134 ms | 118 ms |
| workbench activated | 126 ms | 129 ms | 126 ms | 140 ms | 122 ms |
| grammars preloaded | 136 ms | 138 ms | 137 ms | 151 ms | 124 ms |
| file read from disk | 138 ms | 141 ms | 153 ms | 248 ms | 135 ms |
| file decoded | 138 ms | 141 ms | 153 ms | 248 ms | 135 ms |
| document built | 139 ms | 142 ms | 153 ms | 248 ms | 135 ms |
| tokenizer attached to editor | 158 ms | 170 ms | 194 ms | 289 ms | — |
| tabs opened | 143 ms | 148 ms | 162 ms | 258 ms | 152 ms |
| built-in extensions registered | 299 ms | 302 ms | 333 ms | 420 ms | 199 ms |
| frame with file text | 156 ms | 163 ms | 177 ms | 272 ms | 165 ms |
| frame with highlighting | 279 ms | 281 ms | 314 ms | 402 ms | — |
| extension host up | 530 ms | 531 ms | 603 ms | 1070 ms | 378 ms |
| startup complete | 293 ms | 295 ms | 326 ms | 415 ms | 191 ms |
| to text (black box) | 158 ms | 165 ms | 179 ms | 274 ms | 166 ms |
| to highlight (black box) | 279 ms | 282 ms | 314 ms | 403 ms | — |
| gap black − white (text) | 2 ms | 3 ms | 1 ms | 1 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 35 ms | 14 ms | 9 ms | 10 ms | 23 ms | 8 ms | 3 ms |
| `medium` | 33 ms | 14 ms | 12 ms | 9 ms | 19 ms | 7 ms | 4 ms |
| `large` | 31 ms | 24 ms | 26 ms | 17 ms | 54 ms | 14 ms | 19 ms |
| `xlarge` | 25 ms | 31 ms | 18 ms | 20 ms | 170 ms | 16 ms | 71 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
