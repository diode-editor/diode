# File open benchmark

- Recorded: 2026-11-03T05:59:30.832Z, commit `b91dec91e8d0`, diode nightly-b91dec9
- Machine: AMD EPYC 9V45 96-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 17 ms; binary floor (`diode --version` over PTY, median): 42 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **92 ms** | 66 ms | 108 ms | 178 ms | 5 ms | 272 MB | 11 |
| `medium` | 126.7 KB | 2000 | **100 ms** | 75 ms | 117 ms | 189 ms | 5 ms | 281 MB | 11 |
| `large` | 1.3 MB | 20000 | **105 ms** | 80 ms | 122 ms | 198 ms | 4 ms | 296 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **166 ms** | 140 ms | 183 ms | 241 ms | 9 ms | 351 MB | 5 |
| `log500m` | 497 MB | 5295839 | **99 ms** | 74 ms | 116 ms | — (plaintext) | 1 ms | 314 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 6 ms | 6 ms | 8 ms | 5 ms |
| node ready (bootstrapComplete) | 48 ms | 50 ms | 53 ms | 63 ms | 45 ms |
| bundle executed (main:start) | 48 ms | 50 ms | 53 ms | 63 ms | 45 ms |
| config loaded | 63 ms | 64 ms | 64 ms | 76 ms | 58 ms |
| keybindings loaded | 63 ms | 65 ms | 64 ms | 77 ms | 61 ms |
| session state loaded | 63 ms | 65 ms | 64 ms | 77 ms | 61 ms |
| extensions scanned | 59 ms | 62 ms | 62 ms | 73 ms | 55 ms |
| themes ready | 65 ms | 67 ms | 67 ms | 80 ms | 63 ms |
| DI container created | 67 ms | 69 ms | 70 ms | 83 ms | 65 ms |
| workbench mounted | 85 ms | 89 ms | 90 ms | 106 ms | 81 ms |
| first frame | 85 ms | 89 ms | 90 ms | 106 ms | 81 ms |
| workbench activated | 88 ms | 93 ms | 93 ms | 109 ms | 84 ms |
| grammars preloaded | 93 ms | 100 ms | 99 ms | 115 ms | 86 ms |
| file read from disk | 95 ms | 102 ms | 106 ms | 165 ms | 93 ms |
| file decoded | 95 ms | 102 ms | 106 ms | 165 ms | 93 ms |
| document built | 95 ms | 103 ms | 107 ms | 165 ms | 93 ms |
| tokenizer attached to editor | 107 ms | 117 ms | 123 ms | 184 ms | — |
| tabs opened | 97 ms | 107 ms | 112 ms | 172 ms | 105 ms |
| built-in extensions registered | 194 ms | 205 ms | 214 ms | 256 ms | 142 ms |
| frame with file text | 107 ms | 115 ms | 121 ms | 182 ms | 115 ms |
| frame with highlighting | 178 ms | 188 ms | 198 ms | 241 ms | — |
| extension host up | 346 ms | 382 ms | 417 ms | 748 ms | 261 ms |
| startup complete | 190 ms | 200 ms | 210 ms | 252 ms | 138 ms |
| to text (black box) | 108 ms | 117 ms | 122 ms | 183 ms | 116 ms |
| to highlight (black box) | 178 ms | 189 ms | 198 ms | 241 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 1 ms | 1 ms | 2 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 10 ms | 6 ms | 6 ms | 4 ms | — | 4 ms | 2 ms |
| `medium` failed | 23 ms | 11 ms | 6 ms | 5 ms | — | 3 ms | 4 ms |
| `large` failed | 26 ms | 18 ms | 16 ms | 12 ms | — | 10 ms | 19 ms |
| `xlarge` failed | 20 ms | 21 ms | 16 ms | 17 ms | — | 9 ms | 39 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
