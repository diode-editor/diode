# File open benchmark

- Recorded: 2026-11-03T01:27:50.477Z, commit `4066e7be4d66`, diode nightly-4066e7b
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 26 ms; binary floor (`diode --version` over PTY, median): 65 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **149 ms** | 110 ms | 175 ms | 291 ms | 16 ms | 257 MB | 11 |
| `medium` | 126.7 KB | 2000 | **158 ms** | 119 ms | 184 ms | 301 ms | 9 ms | 282 MB | 11 |
| `large` | 1.3 MB | 20000 | **169 ms** | 130 ms | 195 ms | 312 ms | 3 ms | 292 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **259 ms** | 220 ms | 285 ms | 391 ms | 9 ms | 342 MB | 5 |
| `log500m` | 497 MB | 5295839 | **161 ms** | 122 ms | 187 ms | — (plaintext) | 8 ms | 306 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 8 ms | 10 ms | 6 ms |
| node ready (bootstrapComplete) | 70 ms | 72 ms | 72 ms | 87 ms | 66 ms |
| bundle executed (main:start) | 70 ms | 72 ms | 72 ms | 87 ms | 66 ms |
| config loaded | 91 ms | 94 ms | 91 ms | 105 ms | 84 ms |
| keybindings loaded | 91 ms | 94 ms | 91 ms | 107 ms | 87 ms |
| session state loaded | 92 ms | 95 ms | 92 ms | 107 ms | 87 ms |
| extensions scanned | 87 ms | 89 ms | 87 ms | 100 ms | 80 ms |
| themes ready | 95 ms | 99 ms | 96 ms | 112 ms | 90 ms |
| DI container created | 100 ms | 103 ms | 101 ms | 116 ms | 94 ms |
| workbench mounted | 135 ms | 141 ms | 139 ms | 154 ms | 127 ms |
| first frame | 135 ms | 141 ms | 139 ms | 154 ms | 127 ms |
| workbench activated | 146 ms | 148 ms | 150 ms | 165 ms | 133 ms |
| grammars preloaded | 152 ms | 155 ms | 155 ms | 170 ms | 136 ms |
| file read from disk | 155 ms | 159 ms | 169 ms | 260 ms | 149 ms |
| file decoded | 155 ms | 159 ms | 169 ms | 260 ms | 149 ms |
| document built | 156 ms | 159 ms | 169 ms | 260 ms | 149 ms |
| tokenizer attached to editor | 175 ms | 183 ms | 196 ms | 283 ms | — |
| tabs opened | 160 ms | 166 ms | 180 ms | 269 ms | 172 ms |
| built-in extensions registered | 314 ms | 327 ms | 337 ms | 415 ms | 228 ms |
| frame with file text | 174 ms | 181 ms | 194 ms | 282 ms | 187 ms |
| frame with highlighting | 288 ms | 301 ms | 312 ms | 391 ms | — |
| extension host up | 574 ms | 619 ms | 683 ms | 1121 ms | 417 ms |
| startup complete | 307 ms | 320 ms | 330 ms | 409 ms | 221 ms |
| to text (black box) | 175 ms | 184 ms | 195 ms | 285 ms | 187 ms |
| to highlight (black box) | 291 ms | 301 ms | 312 ms | 391 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 34 ms | 13 ms | 12 ms | 11 ms | — | 7 ms | 4 ms |
| `medium` failed | 34 ms | 14 ms | 11 ms | 12 ms | — | 9 ms | 5 ms |
| `large` failed | 39 ms | 27 ms | 19 ms | 21 ms | — | 15 ms | 17 ms |
| `xlarge` failed | 36 ms | 39 ms | 23 ms | 25 ms | — | 15 ms | 92 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
