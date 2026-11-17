# File open benchmark

- Recorded: 2026-11-17T10:04:02.660Z, commit `16bf3defd22d`, diode nightly-16bf3de
- Machine: AMD EPYC 9V45 96-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 18 ms; binary floor (`diode --version` over PTY, median): 49 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **109 ms** | 78 ms | 127 ms | 197 ms | 5 ms | 268 MB | 11 |
| `medium` | 126.7 KB | 2000 | **107 ms** | 75 ms | 125 ms | 194 ms | 4 ms | 292 MB | 11 |
| `large` | 1.3 MB | 20000 | **116 ms** | 85 ms | 134 ms | 205 ms | 3 ms | 312 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **188 ms** | 156 ms | 205 ms | 261 ms | 11 ms | 365 MB | 5 |
| `log500m` | 497 MB | 5295839 | **117 ms** | 86 ms | 135 ms | — (plaintext) | 4 ms | 322 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 6 ms | 6 ms | 8 ms | 5 ms |
| node ready (bootstrapComplete) | 52 ms | 52 ms | 55 ms | 73 ms | 50 ms |
| bundle executed (main:start) | 52 ms | 52 ms | 55 ms | 73 ms | 50 ms |
| config loaded | 65 ms | 65 ms | 69 ms | 95 ms | 65 ms |
| keybindings loaded | 65 ms | 65 ms | 69 ms | 95 ms | 68 ms |
| session state loaded | 66 ms | 65 ms | 69 ms | 95 ms | 68 ms |
| extensions scanned | 62 ms | 62 ms | 66 ms | 90 ms | 61 ms |
| themes ready | 69 ms | 68 ms | 72 ms | 101 ms | 70 ms |
| DI container created | 71 ms | 71 ms | 74 ms | 103 ms | 72 ms |
| workbench mounted | 98 ms | 96 ms | 99 ms | 127 ms | 97 ms |
| first frame | 98 ms | 96 ms | 99 ms | 127 ms | 97 ms |
| workbench activated | 103 ms | 101 ms | 103 ms | 132 ms | 103 ms |
| grammars preloaded | 110 ms | 108 ms | 110 ms | 135 ms | 106 ms |
| file read from disk | 111 ms | 110 ms | 117 ms | 181 ms | 114 ms |
| file decoded | 112 ms | 110 ms | 117 ms | 181 ms | 114 ms |
| document built | 112 ms | 111 ms | 117 ms | 182 ms | 114 ms |
| tokenizer attached to editor | 126 ms | 125 ms | 134 ms | 201 ms | — |
| tabs opened | 115 ms | 115 ms | 123 ms | 188 ms | 126 ms |
| built-in extensions registered | 214 ms | 212 ms | 224 ms | 280 ms | 166 ms |
| frame with file text | 125 ms | 123 ms | 132 ms | 199 ms | 135 ms |
| frame with highlighting | 196 ms | 193 ms | 205 ms | 261 ms | — |
| extension host up | 373 ms | 382 ms | 444 ms | 770 ms | 306 ms |
| startup complete | 209 ms | 206 ms | 218 ms | 274 ms | 159 ms |
| to text (black box) | 127 ms | 125 ms | 134 ms | 205 ms | 135 ms |
| to highlight (black box) | 197 ms | 194 ms | 205 ms | 261 ms | — |
| gap black − white (text) | 2 ms | 1 ms | 1 ms | 3 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 10 ms | 6 ms | 5 ms | 5 ms | — | 4 ms | 2 ms |
| `medium` failed | 17 ms | 8 ms | 5 ms | 6 ms | — | 4 ms | 3 ms |
| `large` failed | 22 ms | 18 ms | 17 ms | 18 ms | — | 15 ms | 13 ms |
| `xlarge` failed | 28 ms | 21 ms | 17 ms | 17 ms | — | 11 ms | 39 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
