# File open benchmark

- Recorded: 2026-11-14T20:58:35.967Z, commit `468d9bfa734e`, diode nightly-468d9bf
- Machine: Intel(R) Xeon(R) 6975P-C (4 cores, 15 GB), linux 7.0.0-1016-aws
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 17 ms; binary floor (`diode --version` over PTY, median): 46 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **114 ms** | 84 ms | 130 ms | 211 ms | 7 ms | 273 MB | 11 |
| `medium` | 126.7 KB | 2000 | **117 ms** | 88 ms | 134 ms | 216 ms | 4 ms | 288 MB | 11 |
| `large` | 1.3 MB | 20000 | **127 ms** | 97 ms | 144 ms | 226 ms | 7 ms | 301 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **194 ms** | 164 ms | 210 ms | 281 ms | 2 ms | 359 MB | 5 |
| `log500m` | 497 MB | 5295839 | **122 ms** | 92 ms | 138 ms | — (plaintext) | 3 ms | 319 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 5 ms | 6 ms | 6 ms | 4 ms |
| node ready (bootstrapComplete) | 53 ms | 52 ms | 54 ms | 61 ms | 52 ms |
| bundle executed (main:start) | 53 ms | 52 ms | 54 ms | 61 ms | 52 ms |
| config loaded | 68 ms | 65 ms | 68 ms | 76 ms | 71 ms |
| keybindings loaded | 68 ms | 65 ms | 69 ms | 77 ms | 71 ms |
| session state loaded | 69 ms | 65 ms | 69 ms | 77 ms | 71 ms |
| extensions scanned | 63 ms | 61 ms | 64 ms | 72 ms | 65 ms |
| themes ready | 71 ms | 69 ms | 72 ms | 80 ms | 74 ms |
| DI container created | 75 ms | 72 ms | 75 ms | 84 ms | 76 ms |
| workbench mounted | 101 ms | 100 ms | 103 ms | 110 ms | 100 ms |
| first frame | 100 ms | 100 ms | 103 ms | 110 ms | 100 ms |
| workbench activated | 106 ms | 106 ms | 108 ms | 115 ms | 106 ms |
| grammars preloaded | 114 ms | 114 ms | 116 ms | 123 ms | 107 ms |
| file read from disk | 116 ms | 116 ms | 127 ms | 191 ms | 114 ms |
| file decoded | 116 ms | 116 ms | 127 ms | 191 ms | 114 ms |
| document built | 116 ms | 116 ms | 127 ms | 191 ms | 114 ms |
| tokenizer attached to editor | 131 ms | 133 ms | 145 ms | 210 ms | — |
| tabs opened | 120 ms | 120 ms | 132 ms | 198 ms | 126 ms |
| built-in extensions registered | 231 ms | 233 ms | 242 ms | 296 ms | 165 ms |
| frame with file text | 130 ms | 132 ms | 142 ms | 208 ms | 137 ms |
| frame with highlighting | 211 ms | 216 ms | 226 ms | 281 ms | — |
| extension host up | 401 ms | 412 ms | 474 ms | 848 ms | 307 ms |
| startup complete | 221 ms | 226 ms | 235 ms | 290 ms | 158 ms |
| to text (black box) | 130 ms | 134 ms | 144 ms | 210 ms | 138 ms |
| to highlight (black box) | 211 ms | 216 ms | 226 ms | 281 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 12 ms | 7 ms | 5 ms | 7 ms | — | 4 ms | 2 ms |
| `medium` failed | 29 ms | 12 ms | 8 ms | 7 ms | — | 4 ms | 4 ms |
| `large` failed | 24 ms | 21 ms | 16 ms | 15 ms | — | 17 ms | 16 ms |
| `xlarge` failed | 42 ms | 39 ms | 19 ms | 45 ms | — | 11 ms | 57 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
