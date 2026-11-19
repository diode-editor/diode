# File open benchmark

- Recorded: 2026-11-19T01:32:33.239Z, commit `b24b5fe758b5`, diode nightly-b24b5fe
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 73 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **173 ms** | 125 ms | 198 ms | 310 ms | 18 ms | 293 MB | 11 |
| `medium` | 126.7 KB | 2000 | **170 ms** | 122 ms | 194 ms | 307 ms | 8 ms | 301 MB | 11 |
| `large` | 1.3 MB | 20000 | **190 ms** | 142 ms | 215 ms | 329 ms | 11 ms | 312 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **277 ms** | 229 ms | 301 ms | 396 ms | 25 ms | 361 MB | 5 |
| `log500m` | 497 MB | 5295839 | **182 ms** | 134 ms | 206 ms | — (plaintext) | 2 ms | 324 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 8 ms | 7 ms | 8 ms | 9 ms | 6 ms |
| node ready (bootstrapComplete) | 78 ms | 78 ms | 82 ms | 93 ms | 71 ms |
| bundle executed (main:start) | 78 ms | 78 ms | 82 ms | 93 ms | 71 ms |
| config loaded | 100 ms | 98 ms | 104 ms | 111 ms | 97 ms |
| keybindings loaded | 100 ms | 100 ms | 104 ms | 111 ms | 98 ms |
| session state loaded | 100 ms | 100 ms | 104 ms | 112 ms | 98 ms |
| extensions scanned | 92 ms | 93 ms | 97 ms | 105 ms | 90 ms |
| themes ready | 105 ms | 105 ms | 110 ms | 120 ms | 101 ms |
| DI container created | 110 ms | 109 ms | 113 ms | 125 ms | 105 ms |
| workbench mounted | 155 ms | 150 ms | 156 ms | 176 ms | 145 ms |
| first frame | 155 ms | 150 ms | 156 ms | 176 ms | 145 ms |
| workbench activated | 162 ms | 158 ms | 164 ms | 183 ms | 153 ms |
| grammars preloaded | 168 ms | 163 ms | 168 ms | 191 ms | 156 ms |
| file read from disk | 172 ms | 168 ms | 185 ms | 275 ms | 168 ms |
| file decoded | 172 ms | 168 ms | 185 ms | 275 ms | 168 ms |
| document built | 172 ms | 168 ms | 185 ms | 275 ms | 169 ms |
| tokenizer attached to editor | 194 ms | 194 ms | 216 ms | 303 ms | — |
| tabs opened | 176 ms | 175 ms | 196 ms | 286 ms | 190 ms |
| built-in extensions registered | 343 ms | 342 ms | 366 ms | 434 ms | 258 ms |
| frame with file text | 193 ms | 192 ms | 214 ms | 301 ms | 206 ms |
| frame with highlighting | 309 ms | 306 ms | 329 ms | 396 ms | — |
| extension host up | 598 ms | 644 ms | 724 ms | 1159 ms | 443 ms |
| startup complete | 331 ms | 329 ms | 352 ms | 419 ms | 244 ms |
| to text (black box) | 198 ms | 194 ms | 215 ms | 301 ms | 206 ms |
| to highlight (black box) | 310 ms | 307 ms | 329 ms | 396 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 1 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 35 ms | 13 ms | 12 ms | 10 ms | — | 8 ms | 4 ms |
| `medium` failed | 35 ms | 15 ms | 11 ms | 10 ms | — | 6 ms | 8 ms |
| `large` failed | 32 ms | 22 ms | 21 ms | 23 ms | — | 15 ms | 23 ms |
| `xlarge` failed | 29 ms | 29 ms | 24 ms | 20 ms | — | 16 ms | 96 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
