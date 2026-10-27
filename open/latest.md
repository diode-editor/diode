# File open benchmark

- Recorded: 2026-10-27T08:11:44.111Z, commit `28c37312af6a`, diode nightly-28c3731
- Machine: AMD EPYC 9V45 96-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 19 ms; binary floor (`diode --version` over PTY, median): 44 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **88 ms** | 63 ms | 107 ms | 180 ms | 14 ms | 255 MB | 11 |
| `medium` | 126.7 KB | 2000 | **93 ms** | 69 ms | 112 ms | 189 ms | 4 ms | 277 MB | 11 |
| `large` | 1.3 MB | 20000 | **102 ms** | 77 ms | 121 ms | 205 ms | 10 ms | 297 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **163 ms** | 138 ms | 181 ms | 268 ms | 12 ms | 377 MB | 5 |
| `log500m` | 497 MB | 5295839 | **105 ms** | 80 ms | 124 ms | — (plaintext) | 32 ms ⚠ noisy | 270 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 5 ms | 7 ms | 7 ms | 5 ms |
| node ready (bootstrapComplete) | 49 ms | 50 ms | 53 ms | 55 ms | 47 ms |
| bundle executed (main:start) | 49 ms | 50 ms | 53 ms | 55 ms | 47 ms |
| config loaded | 61 ms | 64 ms | 64 ms | 70 ms | 57 ms |
| keybindings loaded | 61 ms | 64 ms | 64 ms | 72 ms | 58 ms |
| session state loaded | 61 ms | 64 ms | 64 ms | 72 ms | 58 ms |
| extensions scanned | 59 ms | 59 ms | 62 ms | 64 ms | 55 ms |
| themes ready | 65 ms | 66 ms | 67 ms | 74 ms | 62 ms |
| DI container created | 67 ms | 68 ms | 70 ms | 76 ms | 64 ms |
| workbench mounted | 85 ms | 85 ms | 89 ms | 94 ms | 86 ms |
| first frame | 85 ms | 85 ms | 89 ms | 94 ms | 86 ms |
| workbench activated | 87 ms | 89 ms | 92 ms | 97 ms | 89 ms |
| grammars preloaded | 91 ms | 96 ms | 99 ms | 104 ms | 95 ms |
| file read from disk | 92 ms | 98 ms | 106 ms | 163 ms | 103 ms |
| file decoded | 92 ms | 98 ms | 106 ms | 163 ms | 103 ms |
| document built | 92 ms | 98 ms | 106 ms | 164 ms | 103 ms |
| tokenizer attached to editor | 107 ms | 115 ms | 135 ms | 196 ms | — |
| tabs opened | 95 ms | 101 ms | 111 ms | 171 ms | 115 ms |
| built-in extensions registered | 199 ms | 204 ms | 221 ms | 281 ms | 151 ms |
| frame with file text | 105 ms | 111 ms | 119 ms | 180 ms | 124 ms |
| frame with highlighting | 180 ms | 188 ms | 205 ms | 268 ms | — |
| extension host up | 357 ms | 375 ms | 425 ms | 737 ms | 290 ms |
| startup complete | 194 ms | 200 ms | 217 ms | 277 ms | 146 ms |
| to text (black box) | 107 ms | 112 ms | 121 ms | 181 ms | 124 ms |
| to highlight (black box) | 180 ms | 189 ms | 205 ms | 268 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 1 ms | 2 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 11 ms | 5 ms | 5 ms | 4 ms | 5 ms | 3 ms | 2 ms |
| `medium` | 18 ms | 9 ms | 7 ms | 5 ms | 9 ms | 4 ms | 2 ms |
| `large` | 25 ms | 14 ms | 12 ms | 14 ms | 39 ms | 7 ms | 10 ms |
| `xlarge` | 22 ms | 18 ms | 11 ms | 14 ms | 119 ms | 7 ms | 43 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
