# File open benchmark

- Recorded: 2026-11-02T08:26:11.953Z, commit `a0d16458e1de`, diode nightly-a0d1645
- Machine: AMD EPYC 9V45 96-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 19 ms; binary floor (`diode --version` over PTY, median): 48 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **99 ms** | 69 ms | 117 ms | 189 ms | 4 ms | 267 MB | 11 |
| `medium` | 126.7 KB | 2000 | **106 ms** | 76 ms | 124 ms | 203 ms | 4 ms | 284 MB | 11 |
| `large` | 1.3 MB | 20000 | **121 ms** | 92 ms | 140 ms | 228 ms | 18 ms | 296 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **171 ms** | 141 ms | 189 ms | 283 ms | 11 ms | 380 MB | 5 |
| `log500m` | 497 MB | 5295839 | **101 ms** | 72 ms | 120 ms | — (plaintext) | 3 ms | 273 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 6 ms | 7 ms | 9 ms | 5 ms |
| node ready (bootstrapComplete) | 51 ms | 54 ms | 56 ms | 61 ms | 48 ms |
| bundle executed (main:start) | 51 ms | 54 ms | 56 ms | 61 ms | 48 ms |
| config loaded | 66 ms | 71 ms | 67 ms | 84 ms | 59 ms |
| keybindings loaded | 66 ms | 71 ms | 67 ms | 88 ms | 59 ms |
| session state loaded | 66 ms | 71 ms | 67 ms | 88 ms | 59 ms |
| extensions scanned | 62 ms | 69 ms | 64 ms | 77 ms | 55 ms |
| themes ready | 69 ms | 75 ms | 73 ms | 90 ms | 63 ms |
| DI container created | 72 ms | 77 ms | 76 ms | 93 ms | 65 ms |
| workbench mounted | 90 ms | 95 ms | 102 ms | 112 ms | 85 ms |
| first frame | 90 ms | 95 ms | 102 ms | 112 ms | 85 ms |
| workbench activated | 93 ms | 98 ms | 105 ms | 115 ms | 88 ms |
| grammars preloaded | 100 ms | 105 ms | 114 ms | 119 ms | 92 ms |
| file read from disk | 102 ms | 107 ms | 121 ms | 167 ms | 99 ms |
| file decoded | 102 ms | 107 ms | 122 ms | 167 ms | 99 ms |
| document built | 102 ms | 107 ms | 122 ms | 167 ms | 99 ms |
| tokenizer attached to editor | 117 ms | 128 ms | 153 ms | 202 ms | — |
| tabs opened | 106 ms | 112 ms | 128 ms | 177 ms | 110 ms |
| built-in extensions registered | 206 ms | 223 ms | 254 ms | 299 ms | 147 ms |
| frame with file text | 116 ms | 122 ms | 138 ms | 185 ms | 119 ms |
| frame with highlighting | 189 ms | 203 ms | 228 ms | 283 ms | — |
| extension host up | 367 ms | 399 ms | 459 ms | 807 ms | 281 ms |
| startup complete | 202 ms | 219 ms | 250 ms | 295 ms | 142 ms |
| to text (black box) | 117 ms | 124 ms | 140 ms | 189 ms | 120 ms |
| to highlight (black box) | 189 ms | 203 ms | 228 ms | 283 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 2 ms | 2 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 10 ms | 6 ms | 6 ms | 5 ms | 9 ms | 3 ms | 2 ms |
| `medium` | 20 ms | 13 ms | 8 ms | 9 ms | 16 ms | 5 ms | 4 ms |
| `large` | 28 ms | 20 ms | 18 ms | 14 ms | 52 ms | 14 ms | 13 ms |
| `xlarge` | 22 ms | 24 ms | 14 ms | 19 ms | 158 ms | 13 ms | 44 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
