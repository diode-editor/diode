# File open benchmark

- Recorded: 2026-11-15T21:55:47.655Z, commit `11d2751b22db`, diode nightly-11d2751
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 23 ms; binary floor (`diode --version` over PTY, median): 68 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **163 ms** | 118 ms | 186 ms | 300 ms | 9 ms | 274 MB | 11 |
| `medium` | 126.7 KB | 2000 | **171 ms** | 126 ms | 194 ms | 315 ms | 20 ms | 291 MB | 11 |
| `large` | 1.3 MB | 20000 | **197 ms** | 152 ms | 220 ms | 330 ms | 14 ms | 303 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **279 ms** | 234 ms | 302 ms | 399 ms | 9 ms | 355 MB | 5 |
| `log500m` | 497 MB | 5295839 | **181 ms** | 136 ms | 205 ms | — (plaintext) | 2 ms | 310 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 7 ms | 8 ms | 5 ms |
| node ready (bootstrapComplete) | 73 ms | 78 ms | 88 ms | 90 ms | 69 ms |
| bundle executed (main:start) | 73 ms | 78 ms | 88 ms | 90 ms | 69 ms |
| config loaded | 95 ms | 99 ms | 106 ms | 114 ms | 87 ms |
| keybindings loaded | 97 ms | 99 ms | 106 ms | 114 ms | 87 ms |
| session state loaded | 97 ms | 99 ms | 106 ms | 114 ms | 87 ms |
| extensions scanned | 89 ms | 96 ms | 101 ms | 106 ms | 81 ms |
| themes ready | 101 ms | 105 ms | 112 ms | 118 ms | 93 ms |
| DI container created | 105 ms | 109 ms | 116 ms | 121 ms | 97 ms |
| workbench mounted | 148 ms | 154 ms | 165 ms | 168 ms | 146 ms |
| first frame | 148 ms | 153 ms | 165 ms | 168 ms | 146 ms |
| workbench activated | 154 ms | 160 ms | 172 ms | 175 ms | 152 ms |
| grammars preloaded | 160 ms | 165 ms | 177 ms | 180 ms | 155 ms |
| file read from disk | 163 ms | 169 ms | 190 ms | 271 ms | 167 ms |
| file decoded | 163 ms | 169 ms | 190 ms | 271 ms | 167 ms |
| document built | 163 ms | 169 ms | 190 ms | 272 ms | 167 ms |
| tokenizer attached to editor | 184 ms | 196 ms | 220 ms | 302 ms | — |
| tabs opened | 169 ms | 177 ms | 200 ms | 284 ms | 187 ms |
| built-in extensions registered | 331 ms | 344 ms | 358 ms | 427 ms | 250 ms |
| frame with file text | 184 ms | 194 ms | 218 ms | 300 ms | 204 ms |
| frame with highlighting | 300 ms | 314 ms | 329 ms | 398 ms | — |
| extension host up | 584 ms | 645 ms | 706 ms | 1150 ms | 453 ms |
| startup complete | 321 ms | 334 ms | 348 ms | 417 ms | 240 ms |
| to text (black box) | 186 ms | 194 ms | 220 ms | 302 ms | 205 ms |
| to highlight (black box) | 300 ms | 315 ms | 330 ms | 399 ms | — |
| gap black − white (text) | 2 ms | 1 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 35 ms | 12 ms | 10 ms | 12 ms | — | 9 ms | 4 ms |
| `medium` failed | 33 ms | 14 ms | 13 ms | 11 ms | — | 7 ms | 7 ms |
| `large` failed | 36 ms | 23 ms | 18 ms | 18 ms | — | 17 ms | 28 ms |
| `xlarge` failed | 25 ms | 38 ms | 21 ms | 37 ms | — | 29 ms | 86 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
