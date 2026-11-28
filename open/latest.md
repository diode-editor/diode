# File open benchmark

- Recorded: 2026-11-28T14:35:09.211Z, commit `d5f7a97b776e`, diode nightly-d5f7a97
- Machine: AMD EPYC 9V45 96-Core Processor (4 cores, 16 GB), linux 7.0.0-1020-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 17 ms; binary floor (`diode --version` over PTY, median): 52 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **130 ms** | 95 ms | 148 ms | 226 ms | 17 ms | 298 MB | 11 |
| `medium` | 126.7 KB | 2000 | **133 ms** | 99 ms | 151 ms | 236 ms | 5 ms | 304 MB | 11 |
| `large` | 1.3 MB | 20000 | **144 ms** | 109 ms | 161 ms | 238 ms | 6 ms | 319 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **207 ms** | 172 ms | 225 ms | 292 ms | 2 ms | 373 MB | 5 |
| `log500m` | 497 MB | 5295839 | **135 ms** | 100 ms | 152 ms | — (plaintext) | 1 ms | 347 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 10 ms | 12 ms | 5 ms |
| node ready (bootstrapComplete) | 60 ms | 61 ms | 67 ms | 79 ms | 55 ms |
| bundle executed (main:start) | 60 ms | 61 ms | 67 ms | 79 ms | 55 ms |
| config loaded | 77 ms | 82 ms | 89 ms | 102 ms | 74 ms |
| keybindings loaded | 77 ms | 82 ms | 89 ms | 104 ms | 74 ms |
| session state loaded | 77 ms | 82 ms | 89 ms | 104 ms | 74 ms |
| extensions scanned | 75 ms | 77 ms | 82 ms | 97 ms | 71 ms |
| themes ready | 84 ms | 85 ms | 92 ms | 107 ms | 77 ms |
| DI container created | 86 ms | 88 ms | 95 ms | 110 ms | 79 ms |
| workbench mounted | 117 ms | 120 ms | 123 ms | 138 ms | 109 ms |
| first frame | 117 ms | 119 ms | 123 ms | 138 ms | 108 ms |
| workbench activated | 124 ms | 125 ms | 128 ms | 143 ms | 115 ms |
| grammars preloaded | 131 ms | 130 ms | 133 ms | 151 ms | 119 ms |
| file read from disk | 133 ms | 133 ms | 141 ms | 202 ms | 126 ms |
| file decoded | 133 ms | 133 ms | 141 ms | 202 ms | 126 ms |
| document built | 133 ms | 133 ms | 141 ms | 203 ms | 126 ms |
| tokenizer attached to editor | 148 ms | 151 ms | 161 ms | 226 ms | — |
| tabs opened | 136 ms | 138 ms | 147 ms | 212 ms | 141 ms |
| built-in extensions registered | 252 ms | 260 ms | 264 ms | 316 ms | 188 ms |
| frame with file text | 147 ms | 150 ms | 159 ms | 224 ms | 152 ms |
| frame with highlighting | 226 ms | 235 ms | 238 ms | 292 ms | — |
| extension host up | 432 ms | 475 ms | 506 ms | 869 ms | 328 ms |
| startup complete | 243 ms | 252 ms | 255 ms | 307 ms | 179 ms |
| to text (black box) | 148 ms | 151 ms | 161 ms | 225 ms | 152 ms |
| to highlight (black box) | 226 ms | 236 ms | 238 ms | 292 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 1 ms | 0 ms | 2 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 17 ms | 11 ms | 7 ms | 7 ms | — | 5 ms | 3 ms |
| `medium` failed | 23 ms | 11 ms | 10 ms | 12 ms | — | 6 ms | 5 ms |
| `large` failed | 34 ms | 18 ms | 23 ms | 20 ms | — | 12 ms | 13 ms |
| `xlarge` failed | 25 ms | 31 ms | 25 ms | 22 ms | — | 13 ms | 51 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
