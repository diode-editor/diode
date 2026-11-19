# File open benchmark

- Recorded: 2026-11-19T11:21:26.051Z, commit `7a26fde1e798`, diode nightly-7a26fde
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1020-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 24 ms; binary floor (`diode --version` over PTY, median): 73 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **169 ms** | 120 ms | 193 ms | 310 ms | 24 ms | 293 MB | 11 |
| `medium` | 126.7 KB | 2000 | **179 ms** | 130 ms | 203 ms | 319 ms | 3 ms | 301 MB | 11 |
| `large` | 1.3 MB | 20000 | **191 ms** | 142 ms | 215 ms | 331 ms | 15 ms | 311 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **286 ms** | 237 ms | 310 ms | 412 ms | 7 ms | 360 MB | 5 |
| `log500m` | 497 MB | 5295839 | **189 ms** | 140 ms | 213 ms | — (plaintext) | 3 ms | 324 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 8 ms | 7 ms | 10 ms | 6 ms |
| node ready (bootstrapComplete) | 77 ms | 81 ms | 84 ms | 96 ms | 74 ms |
| bundle executed (main:start) | 77 ms | 81 ms | 84 ms | 96 ms | 74 ms |
| config loaded | 103 ms | 105 ms | 108 ms | 122 ms | 96 ms |
| keybindings loaded | 103 ms | 105 ms | 108 ms | 122 ms | 99 ms |
| session state loaded | 104 ms | 106 ms | 108 ms | 122 ms | 99 ms |
| extensions scanned | 95 ms | 98 ms | 100 ms | 115 ms | 89 ms |
| themes ready | 107 ms | 111 ms | 112 ms | 129 ms | 103 ms |
| DI container created | 111 ms | 115 ms | 116 ms | 133 ms | 107 ms |
| workbench mounted | 154 ms | 157 ms | 162 ms | 176 ms | 150 ms |
| first frame | 154 ms | 157 ms | 162 ms | 176 ms | 150 ms |
| workbench activated | 161 ms | 166 ms | 171 ms | 183 ms | 158 ms |
| grammars preloaded | 166 ms | 171 ms | 175 ms | 189 ms | 160 ms |
| file read from disk | 169 ms | 175 ms | 189 ms | 281 ms | 174 ms |
| file decoded | 169 ms | 175 ms | 189 ms | 281 ms | 174 ms |
| document built | 169 ms | 176 ms | 189 ms | 282 ms | 174 ms |
| tokenizer attached to editor | 194 ms | 203 ms | 217 ms | 311 ms | — |
| tabs opened | 174 ms | 184 ms | 200 ms | 292 ms | 195 ms |
| built-in extensions registered | 345 ms | 355 ms | 364 ms | 447 ms | 269 ms |
| frame with file text | 193 ms | 201 ms | 215 ms | 309 ms | 213 ms |
| frame with highlighting | 309 ms | 319 ms | 330 ms | 412 ms | — |
| extension host up | 601 ms | 660 ms | 724 ms | 1180 ms | 473 ms |
| startup complete | 331 ms | 342 ms | 352 ms | 436 ms | 256 ms |
| to text (black box) | 193 ms | 203 ms | 215 ms | 310 ms | 213 ms |
| to highlight (black box) | 310 ms | 319 ms | 331 ms | 412 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 2 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 41 ms | 19 ms | 15 ms | 10 ms | — | 7 ms | 5 ms |
| `medium` failed | 33 ms | 15 ms | 11 ms | 17 ms | — | 11 ms | 5 ms |
| `large` failed | 37 ms | 24 ms | 20 ms | 26 ms | — | 18 ms | 17 ms |
| `xlarge` failed | 30 ms | 27 ms | 14 ms | 25 ms | — | 13 ms | 98 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
