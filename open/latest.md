# File open benchmark

- Recorded: 2026-11-19T10:30:05.911Z, commit `a3e27785ee33`, diode nightly-a3e2778
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 23 ms; binary floor (`diode --version` over PTY, median): 71 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **175 ms** | 127 ms | 198 ms | 321 ms | 25 ms | 293 MB | 11 |
| `medium` | 126.7 KB | 2000 | **180 ms** | 133 ms | 203 ms | 323 ms | 6 ms | 301 MB | 11 |
| `large` | 1.3 MB | 20000 | **195 ms** | 148 ms | 218 ms | 335 ms | 7 ms | 311 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **305 ms** | 258 ms | 328 ms | 440 ms | 23 ms | 360 MB | 5 |
| `log500m` | 497 MB | 5295839 | **201 ms** | 154 ms | 225 ms | — (plaintext) | 8 ms | 329 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 10 ms | 15 ms | 6 ms |
| node ready (bootstrapComplete) | 79 ms | 81 ms | 85 ms | 108 ms | 78 ms |
| bundle executed (main:start) | 79 ms | 81 ms | 85 ms | 108 ms | 78 ms |
| config loaded | 102 ms | 105 ms | 110 ms | 134 ms | 100 ms |
| keybindings loaded | 103 ms | 106 ms | 111 ms | 134 ms | 101 ms |
| session state loaded | 104 ms | 106 ms | 111 ms | 134 ms | 101 ms |
| extensions scanned | 96 ms | 98 ms | 102 ms | 126 ms | 94 ms |
| themes ready | 108 ms | 111 ms | 114 ms | 141 ms | 106 ms |
| DI container created | 111 ms | 115 ms | 118 ms | 145 ms | 110 ms |
| workbench mounted | 156 ms | 159 ms | 161 ms | 189 ms | 163 ms |
| first frame | 156 ms | 159 ms | 161 ms | 189 ms | 163 ms |
| workbench activated | 164 ms | 167 ms | 169 ms | 197 ms | 171 ms |
| grammars preloaded | 169 ms | 172 ms | 174 ms | 203 ms | 173 ms |
| file read from disk | 172 ms | 176 ms | 190 ms | 301 ms | 186 ms |
| file decoded | 173 ms | 176 ms | 190 ms | 301 ms | 186 ms |
| document built | 173 ms | 176 ms | 190 ms | 302 ms | 186 ms |
| tokenizer attached to editor | 197 ms | 205 ms | 218 ms | 330 ms | — |
| tabs opened | 178 ms | 184 ms | 199 ms | 312 ms | 207 ms |
| built-in extensions registered | 356 ms | 357 ms | 371 ms | 474 ms | 282 ms |
| frame with file text | 196 ms | 202 ms | 216 ms | 328 ms | 223 ms |
| frame with highlighting | 321 ms | 323 ms | 335 ms | 440 ms | — |
| extension host up | 614 ms | 664 ms | 731 ms | 1202 ms | 479 ms |
| startup complete | 344 ms | 345 ms | 358 ms | 462 ms | 264 ms |
| to text (black box) | 198 ms | 203 ms | 218 ms | 328 ms | 225 ms |
| to highlight (black box) | 321 ms | 323 ms | 335 ms | 440 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 2 ms | 0 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 41 ms | 16 ms | 13 ms | 12 ms | — | 9 ms | 5 ms |
| `medium` failed | 31 ms | 14 ms | 13 ms | 15 ms | — | 7 ms | 8 ms |
| `large` failed | 37 ms | 23 ms | 22 ms | 24 ms | — | 16 ms | 19 ms |
| `xlarge` failed | 28 ms | 29 ms | 16 ms | 25 ms | — | 15 ms | 87 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
