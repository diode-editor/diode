# File open benchmark

- Recorded: 2026-10-23T22:33:41.762Z, commit `0a5504251277`, diode nightly-0a55042
- Machine: AMD EPYC 9V45 96-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 26 ms; binary floor (`diode --version` over PTY, median): 46 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **88 ms** | 68 ms | 114 ms | 194 ms | 10 ms | 243 MB | 11 |
| `medium` | 126.7 KB | 2000 | **91 ms** | 71 ms | 117 ms | 195 ms | 6 ms | 246 MB | 11 |
| `large` | 1.3 MB | 20000 | **102 ms** | 82 ms | 128 ms | 204 ms | 5 ms | 290 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **161 ms** | 140 ms | 186 ms | 250 ms | 13 ms | 466 MB | 5 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` |
| --- | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 5 ms | 8 ms | 8 ms |
| node ready (bootstrapComplete) | 52 ms | 51 ms | 55 ms | 60 ms |
| bundle executed (main:start) | 52 ms | 51 ms | 55 ms | 60 ms |
| config loaded | 62 ms | 64 ms | 70 ms | 73 ms |
| keybindings loaded | 64 ms | 65 ms | 71 ms | 73 ms |
| session state loaded | 64 ms | 65 ms | 72 ms | 73 ms |
| extensions scanned | 61 ms | 62 ms | 68 ms | 69 ms |
| themes ready | 66 ms | 67 ms | 74 ms | 76 ms |
| DI container created | 69 ms | 70 ms | 77 ms | 79 ms |
| workbench mounted | 90 ms | 90 ms | 94 ms | 99 ms |
| first frame | 90 ms | 90 ms | 94 ms | 99 ms |
| workbench activated | 93 ms | 93 ms | 97 ms | 103 ms |
| grammars preloaded | 101 ms | 98 ms | 103 ms | 110 ms |
| file read from disk | 102 ms | 100 ms | 111 ms | 169 ms |
| file decoded | 102 ms | 100 ms | 111 ms | 169 ms |
| document built | 102 ms | 100 ms | 111 ms | 169 ms |
| tokenizer attached to editor | 114 ms | 117 ms | 128 ms | 187 ms |
| tabs opened | 105 ms | 104 ms | 118 ms | 176 ms |
| built-in extensions registered | 209 ms | 209 ms | 219 ms | 264 ms |
| frame with file text | 113 ms | 115 ms | 126 ms | 185 ms |
| frame with highlighting | 194 ms | 195 ms | 205 ms | 250 ms |
| extension host up | 369 ms | 369 ms | 413 ms | 787 ms |
| startup complete | 206 ms | 205 ms | 215 ms | 261 ms |
| to text (black box) | 114 ms | 117 ms | 128 ms | 186 ms |
| to highlight (black box) | 194 ms | 195 ms | 204 ms | 250 ms |
| gap black − white (text) | 1 ms | 2 ms | 2 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 16 ms | 11 ms | 9 ms | 6 ms | 9 ms | 5 ms | 2 ms |
| `medium` | 24 ms | 11 ms | 7 ms | 8 ms | 13 ms | 4 ms | 2 ms |
| `large` | 23 ms | 13 ms | 12 ms | 13 ms | 42 ms | 9 ms | 13 ms |
| `xlarge` | 24 ms | 20 ms | 10 ms | 14 ms | 106 ms | 10 ms | 43 ms |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
