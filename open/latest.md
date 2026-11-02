# File open benchmark

- Recorded: 2026-11-02T09:59:19.623Z, commit `41758674bd07`, diode nightly-4175867
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 24 ms; binary floor (`diode --version` over PTY, median): 62 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **148 ms** | 110 ms | 172 ms | 286 ms | 9 ms | 272 MB | 11 |
| `medium` | 126.7 KB | 2000 | **147 ms** | 108 ms | 170 ms | 287 ms | 5 ms | 283 MB | 11 |
| `large` | 1.3 MB | 20000 | **166 ms** | 127 ms | 189 ms | 320 ms | 8 ms | 292 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **251 ms** | 213 ms | 275 ms | 402 ms | 2 ms | 369 MB | 5 |
| `log500m` | 497 MB | 5295839 | **154 ms** | 116 ms | 178 ms | — (plaintext) | 7 ms | 304 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 6 ms | 8 ms | 7 ms | 5 ms |
| node ready (bootstrapComplete) | 68 ms | 68 ms | 72 ms | 86 ms | 64 ms |
| bundle executed (main:start) | 68 ms | 68 ms | 72 ms | 86 ms | 64 ms |
| config loaded | 90 ms | 87 ms | 94 ms | 105 ms | 83 ms |
| keybindings loaded | 91 ms | 88 ms | 94 ms | 106 ms | 83 ms |
| session state loaded | 91 ms | 88 ms | 94 ms | 106 ms | 84 ms |
| extensions scanned | 85 ms | 83 ms | 91 ms | 100 ms | 78 ms |
| themes ready | 95 ms | 93 ms | 97 ms | 110 ms | 88 ms |
| DI container created | 98 ms | 97 ms | 101 ms | 114 ms | 92 ms |
| workbench mounted | 133 ms | 129 ms | 134 ms | 149 ms | 126 ms |
| first frame | 133 ms | 129 ms | 134 ms | 149 ms | 126 ms |
| workbench activated | 140 ms | 134 ms | 140 ms | 154 ms | 130 ms |
| grammars preloaded | 147 ms | 144 ms | 145 ms | 160 ms | 133 ms |
| file read from disk | 150 ms | 147 ms | 162 ms | 253 ms | 146 ms |
| file decoded | 150 ms | 147 ms | 162 ms | 253 ms | 146 ms |
| document built | 150 ms | 147 ms | 162 ms | 253 ms | 146 ms |
| tokenizer attached to editor | 173 ms | 176 ms | 204 ms | 292 ms | — |
| tabs opened | 154 ms | 153 ms | 172 ms | 261 ms | 164 ms |
| built-in extensions registered | 310 ms | 314 ms | 344 ms | 426 ms | 220 ms |
| frame with file text | 170 ms | 169 ms | 187 ms | 275 ms | 177 ms |
| frame with highlighting | 285 ms | 288 ms | 319 ms | 402 ms | — |
| extension host up | 552 ms | 593 ms | 669 ms | 1103 ms | 404 ms |
| startup complete | 303 ms | 308 ms | 337 ms | 420 ms | 212 ms |
| to text (black box) | 172 ms | 170 ms | 189 ms | 275 ms | 178 ms |
| to highlight (black box) | 286 ms | 287 ms | 320 ms | 402 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 3 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 34 ms | 14 ms | 11 ms | 10 ms | 22 ms | 8 ms | 4 ms |
| `medium` | 30 ms | 17 ms | 11 ms | 12 ms | 21 ms | 7 ms | 6 ms |
| `large` | 38 ms | 29 ms | 18 ms | 16 ms | 41 ms | 15 ms | 15 ms |
| `xlarge` | 33 ms | 39 ms | 21 ms | 23 ms | 170 ms | 23 ms | 91 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
