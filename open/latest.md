# File open benchmark

- Recorded: 2026-10-31T14:15:19.020Z, commit `c6eb7824bb72`, diode nightly-c6eb782
- Machine: AMD EPYC 9V45 96-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 20 ms; binary floor (`diode --version` over PTY, median): 49 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **100 ms** | 72 ms | 120 ms | 201 ms | 2 ms | 261 MB | 11 |
| `medium` | 126.7 KB | 2000 | **108 ms** | 79 ms | 128 ms | 210 ms | 2 ms | 283 MB | 11 |
| `large` | 1.3 MB | 20000 | **118 ms** | 90 ms | 139 ms | 230 ms | 5 ms | 302 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **187 ms** | 159 ms | 207 ms | 302 ms | 9 ms | 380 MB | 5 |
| `log500m` | 497 MB | 5295839 | **101 ms** | 73 ms | 121 ms | — (plaintext) | 5 ms | 271 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 7 ms | 12 ms | 5 ms |
| node ready (bootstrapComplete) | 51 ms | 54 ms | 57 ms | 74 ms | 45 ms |
| bundle executed (main:start) | 51 ms | 55 ms | 57 ms | 74 ms | 45 ms |
| config loaded | 68 ms | 67 ms | 70 ms | 89 ms | 57 ms |
| keybindings loaded | 69 ms | 67 ms | 70 ms | 89 ms | 58 ms |
| session state loaded | 69 ms | 67 ms | 70 ms | 89 ms | 58 ms |
| extensions scanned | 65 ms | 65 ms | 67 ms | 86 ms | 55 ms |
| themes ready | 72 ms | 71 ms | 75 ms | 93 ms | 61 ms |
| DI container created | 74 ms | 74 ms | 77 ms | 96 ms | 64 ms |
| workbench mounted | 94 ms | 97 ms | 98 ms | 118 ms | 84 ms |
| first frame | 94 ms | 97 ms | 98 ms | 118 ms | 84 ms |
| workbench activated | 98 ms | 101 ms | 102 ms | 122 ms | 88 ms |
| grammars preloaded | 102 ms | 108 ms | 110 ms | 130 ms | 93 ms |
| file read from disk | 104 ms | 111 ms | 119 ms | 188 ms | 99 ms |
| file decoded | 105 ms | 111 ms | 119 ms | 188 ms | 99 ms |
| document built | 105 ms | 111 ms | 119 ms | 188 ms | 99 ms |
| tokenizer attached to editor | 121 ms | 132 ms | 152 ms | 223 ms | — |
| tabs opened | 108 ms | 116 ms | 126 ms | 196 ms | 110 ms |
| built-in extensions registered | 220 ms | 230 ms | 248 ms | 320 ms | 148 ms |
| frame with file text | 119 ms | 126 ms | 136 ms | 206 ms | 121 ms |
| frame with highlighting | 201 ms | 210 ms | 229 ms | 302 ms | — |
| extension host up | 393 ms | 419 ms | 463 ms | 813 ms | 281 ms |
| startup complete | 216 ms | 225 ms | 243 ms | 315 ms | 144 ms |
| to text (black box) | 120 ms | 128 ms | 139 ms | 207 ms | 121 ms |
| to highlight (black box) | 201 ms | 210 ms | 230 ms | 302 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 3 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 18 ms | 8 ms | 9 ms | 6 ms | 10 ms | 4 ms | 3 ms |
| `medium` | 21 ms | 11 ms | 9 ms | 10 ms | 14 ms | 6 ms | 3 ms |
| `large` | 30 ms | 19 ms | 19 ms | 17 ms | 48 ms | 10 ms | 9 ms |
| `xlarge` | 27 ms | 23 ms | 13 ms | 18 ms | 148 ms | 10 ms | 51 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
