# File open benchmark

- Recorded: 2026-11-09T00:06:59.091Z, commit `8033a361e384`, diode nightly-8033a36
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 68 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **165 ms** | 122 ms | 190 ms | 309 ms | 25 ms | 279 MB | 11 |
| `medium` | 126.7 KB | 2000 | **167 ms** | 123 ms | 191 ms | 307 ms | 6 ms | 288 MB | 11 |
| `large` | 1.3 MB | 20000 | **177 ms** | 134 ms | 202 ms | 317 ms | 13 ms | 297 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **260 ms** | 216 ms | 284 ms | 385 ms | 13 ms | 349 MB | 5 |
| `log500m` | 497 MB | 5295839 | **185 ms** | 142 ms | 210 ms | — (plaintext) | 7 ms | 306 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 6 ms | 9 ms | 9 ms | 7 ms |
| node ready (bootstrapComplete) | 73 ms | 72 ms | 76 ms | 80 ms | 69 ms |
| bundle executed (main:start) | 74 ms | 72 ms | 76 ms | 80 ms | 69 ms |
| config loaded | 92 ms | 91 ms | 96 ms | 103 ms | 95 ms |
| keybindings loaded | 95 ms | 91 ms | 97 ms | 103 ms | 95 ms |
| session state loaded | 95 ms | 91 ms | 97 ms | 103 ms | 95 ms |
| extensions scanned | 88 ms | 86 ms | 92 ms | 96 ms | 92 ms |
| themes ready | 99 ms | 97 ms | 101 ms | 107 ms | 99 ms |
| DI container created | 102 ms | 102 ms | 106 ms | 111 ms | 103 ms |
| workbench mounted | 151 ms | 146 ms | 147 ms | 155 ms | 141 ms |
| first frame | 150 ms | 146 ms | 147 ms | 155 ms | 141 ms |
| workbench activated | 157 ms | 154 ms | 155 ms | 162 ms | 149 ms |
| grammars preloaded | 163 ms | 161 ms | 160 ms | 168 ms | 152 ms |
| file read from disk | 166 ms | 165 ms | 172 ms | 260 ms | 164 ms |
| file decoded | 166 ms | 165 ms | 172 ms | 260 ms | 164 ms |
| document built | 166 ms | 166 ms | 172 ms | 260 ms | 164 ms |
| tokenizer attached to editor | 190 ms | 190 ms | 203 ms | 286 ms | — |
| tabs opened | 172 ms | 172 ms | 184 ms | 270 ms | 186 ms |
| built-in extensions registered | 345 ms | 337 ms | 346 ms | 413 ms | 257 ms |
| frame with file text | 189 ms | 189 ms | 200 ms | 284 ms | 209 ms |
| frame with highlighting | 309 ms | 307 ms | 317 ms | 385 ms | — |
| extension host up | 605 ms | 633 ms | 717 ms | 1144 ms | 466 ms |
| startup complete | 334 ms | 327 ms | 336 ms | 404 ms | 247 ms |
| to text (black box) | 190 ms | 191 ms | 202 ms | 284 ms | 210 ms |
| to highlight (black box) | 309 ms | 307 ms | 317 ms | 385 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 2 ms | 0 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 33 ms | 13 ms | 14 ms | 13 ms | — | 10 ms | 5 ms |
| `medium` failed | 35 ms | 16 ms | 12 ms | 10 ms | — | 6 ms | 6 ms |
| `large` failed | 41 ms | 25 ms | 19 ms | 17 ms | — | 20 ms | 17 ms |
| `xlarge` failed | 34 ms | 47 ms | 31 ms | 63 ms | — | 29 ms | 85 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
