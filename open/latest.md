# File open benchmark

- Recorded: 2026-11-02T08:10:31.272Z, commit `903b1fe2374a`, diode nightly-903b1fe
- Machine: AMD EPYC 9V45 96-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 18 ms; binary floor (`diode --version` over PTY, median): 46 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **99 ms** | 71 ms | 117 ms | 192 ms | 9 ms | 265 MB | 11 |
| `medium` | 126.7 KB | 2000 | **103 ms** | 75 ms | 121 ms | 197 ms | 6 ms | 282 MB | 11 |
| `large` | 1.3 MB | 20000 | **113 ms** | 85 ms | 131 ms | 214 ms | 5 ms | 298 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **178 ms** | 150 ms | 196 ms | 290 ms | 11 ms | 372 MB | 5 |
| `log500m` | 497 MB | 5295839 | **109 ms** | 81 ms | 127 ms | — (plaintext) | 1 ms | 273 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 6 ms | 7 ms | 5 ms |
| node ready (bootstrapComplete) | 50 ms | 49 ms | 55 ms | 64 ms | 49 ms |
| bundle executed (main:start) | 50 ms | 49 ms | 55 ms | 64 ms | 49 ms |
| config loaded | 64 ms | 63 ms | 68 ms | 75 ms | 62 ms |
| keybindings loaded | 65 ms | 63 ms | 69 ms | 75 ms | 62 ms |
| session state loaded | 65 ms | 63 ms | 69 ms | 75 ms | 62 ms |
| extensions scanned | 60 ms | 61 ms | 66 ms | 71 ms | 60 ms |
| themes ready | 67 ms | 67 ms | 71 ms | 79 ms | 65 ms |
| DI container created | 69 ms | 69 ms | 73 ms | 87 ms | 68 ms |
| workbench mounted | 89 ms | 88 ms | 94 ms | 111 ms | 90 ms |
| first frame | 89 ms | 88 ms | 94 ms | 111 ms | 90 ms |
| workbench activated | 92 ms | 91 ms | 97 ms | 115 ms | 93 ms |
| grammars preloaded | 100 ms | 99 ms | 105 ms | 123 ms | 99 ms |
| file read from disk | 101 ms | 102 ms | 113 ms | 178 ms | 106 ms |
| file decoded | 101 ms | 102 ms | 113 ms | 178 ms | 106 ms |
| document built | 102 ms | 102 ms | 113 ms | 179 ms | 106 ms |
| tokenizer attached to editor | 116 ms | 122 ms | 145 ms | 213 ms | — |
| tabs opened | 104 ms | 106 ms | 120 ms | 186 ms | 118 ms |
| built-in extensions registered | 212 ms | 216 ms | 232 ms | 307 ms | 156 ms |
| frame with file text | 115 ms | 117 ms | 130 ms | 196 ms | 127 ms |
| frame with highlighting | 192 ms | 197 ms | 214 ms | 290 ms | — |
| extension host up | 362 ms | 385 ms | 439 ms | 804 ms | 283 ms |
| startup complete | 206 ms | 212 ms | 229 ms | 303 ms | 150 ms |
| to text (black box) | 117 ms | 121 ms | 131 ms | 196 ms | 127 ms |
| to highlight (black box) | 192 ms | 197 ms | 214 ms | 290 ms | — |
| gap black − white (text) | 3 ms | 4 ms | 1 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 10 ms | 5 ms | 6 ms | 5 ms | 7 ms | 3 ms | 2 ms |
| `medium` | 26 ms | 12 ms | 7 ms | 7 ms | 16 ms | 4 ms | 4 ms |
| `large` | 33 ms | 17 ms | 20 ms | 12 ms | 44 ms | 9 ms | 13 ms |
| `xlarge` | 21 ms | 33 ms | 15 ms | 16 ms | 147 ms | 7 ms | 43 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
