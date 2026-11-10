# File open benchmark

- Recorded: 2026-11-10T21:44:14.148Z, commit `4511ca2d9a80`, diode nightly-4511ca2
- Machine: AMD EPYC 9V45 96-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 16 ms; binary floor (`diode --version` over PTY, median): 44 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **107 ms** | 80 ms | 124 ms | 201 ms | 6 ms | 276 MB | 11 |
| `medium` | 126.7 KB | 2000 | **103 ms** | 76 ms | 119 ms | 192 ms | 6 ms | 289 MB | 11 |
| `large` | 1.3 MB | 20000 | **118 ms** | 90 ms | 134 ms | 207 ms | 4 ms | 303 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **178 ms** | 150 ms | 194 ms | 254 ms | 11 ms | 359 MB | 5 |
| `log500m` | 497 MB | 5295839 | **110 ms** | 83 ms | 127 ms | — (plaintext) | 1 ms | 295 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 5 ms | 6 ms | 11 ms | 5 ms |
| node ready (bootstrapComplete) | 53 ms | 50 ms | 52 ms | 62 ms | 45 ms |
| bundle executed (main:start) | 53 ms | 50 ms | 52 ms | 62 ms | 45 ms |
| config loaded | 67 ms | 65 ms | 68 ms | 83 ms | 58 ms |
| keybindings loaded | 68 ms | 65 ms | 68 ms | 83 ms | 58 ms |
| session state loaded | 68 ms | 65 ms | 68 ms | 84 ms | 58 ms |
| extensions scanned | 63 ms | 59 ms | 64 ms | 79 ms | 56 ms |
| themes ready | 70 ms | 69 ms | 71 ms | 86 ms | 61 ms |
| DI container created | 72 ms | 71 ms | 73 ms | 88 ms | 63 ms |
| workbench mounted | 97 ms | 93 ms | 97 ms | 116 ms | 86 ms |
| first frame | 97 ms | 93 ms | 97 ms | 116 ms | 86 ms |
| workbench activated | 101 ms | 97 ms | 101 ms | 121 ms | 91 ms |
| grammars preloaded | 106 ms | 102 ms | 109 ms | 123 ms | 95 ms |
| file read from disk | 108 ms | 104 ms | 117 ms | 173 ms | 103 ms |
| file decoded | 108 ms | 104 ms | 117 ms | 173 ms | 103 ms |
| document built | 108 ms | 104 ms | 117 ms | 173 ms | 103 ms |
| tokenizer attached to editor | 123 ms | 119 ms | 135 ms | 194 ms | — |
| tabs opened | 111 ms | 109 ms | 124 ms | 181 ms | 115 ms |
| built-in extensions registered | 221 ms | 209 ms | 224 ms | 272 ms | 158 ms |
| frame with file text | 122 ms | 118 ms | 133 ms | 192 ms | 125 ms |
| frame with highlighting | 201 ms | 192 ms | 206 ms | 253 ms | — |
| extension host up | 375 ms | 394 ms | 436 ms | 782 ms | 290 ms |
| startup complete | 214 ms | 204 ms | 219 ms | 266 ms | 150 ms |
| to text (black box) | 124 ms | 119 ms | 134 ms | 194 ms | 127 ms |
| to highlight (black box) | 201 ms | 192 ms | 207 ms | 254 ms | — |
| gap black − white (text) | 2 ms | 1 ms | 1 ms | 2 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 10 ms | 7 ms | 7 ms | 5 ms | — | 4 ms | 2 ms |
| `medium` failed | 20 ms | 8 ms | 9 ms | 7 ms | — | 3 ms | 3 ms |
| `large` failed | 26 ms | 20 ms | 15 ms | 14 ms | — | 14 ms | 12 ms |
| `xlarge` failed | 26 ms | 27 ms | 17 ms | 20 ms | — | 16 ms | 42 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
