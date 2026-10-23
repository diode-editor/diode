# File open benchmark

- Recorded: 2026-10-23T00:24:10.379Z, commit `cc1ed1b60332`, diode nightly-cc1ed1b
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 58 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **142 ms** | 108 ms | 166 ms | 287 ms | 16 ms | 243 MB | 11 |
| `medium` | 126.7 KB | 2000 | **165 ms** | 132 ms | 189 ms | 303 ms | 6 ms | 267 MB | 11 |
| `large` | 1.3 MB | 20000 | **297 ms** | 264 ms | 322 ms | 424 ms | 16 ms | 304 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **1427 ms** | 1394 ms | 1452 ms | 1552 ms | 98 ms | 700 MB | 5 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` |
| --- | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 6 ms | 7 ms | 9 ms |
| node ready (bootstrapComplete) | 67 ms | 66 ms | 68 ms | 78 ms |
| bundle executed (main:start) | 67 ms | 66 ms | 68 ms | 78 ms |
| config loaded | 83 ms | 83 ms | 87 ms | 95 ms |
| keybindings loaded | 84 ms | 83 ms | 87 ms | 96 ms |
| session state loaded | 84 ms | 84 ms | 87 ms | 96 ms |
| extensions scanned | 80 ms | 80 ms | 82 ms | 92 ms |
| themes ready | 88 ms | 87 ms | 90 ms | 99 ms |
| DI container created | 93 ms | 93 ms | 97 ms | 107 ms |
| workbench mounted | 126 ms | 124 ms | 124 ms | 141 ms |
| first frame | 126 ms | 124 ms | 124 ms | 141 ms |
| workbench activated | 132 ms | 129 ms | 131 ms | 148 ms |
| grammars preloaded | 142 ms | 135 ms | 137 ms | 157 ms |
| file read from disk | 143 ms | 138 ms | 152 ms | 247 ms |
| file decoded | 143 ms | 138 ms | 152 ms | 247 ms |
| document built | 144 ms | 138 ms | 153 ms | 247 ms |
| tokenizer attached to editor | 166 ms | 188 ms | 323 ms | 1451 ms |
| tabs opened | 149 ms | 148 ms | 172 ms | 291 ms |
| built-in extensions registered | 307 ms | 322 ms | 442 ms | 1579 ms |
| frame with file text | 165 ms | 187 ms | 322 ms | 1449 ms |
| frame with highlighting | 287 ms | 302 ms | 424 ms | 1552 ms |
| extension host up | 525 ms | 572 ms | 732 ms | 2254 ms |
| startup complete | 302 ms | 317 ms | 438 ms | 1573 ms |
| to text (black box) | 166 ms | 189 ms | 322 ms | 1452 ms |
| to highlight (black box) | 287 ms | 303 ms | 424 ms | 1552 ms |
| gap black − white (text) | 2 ms | 2 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 34 ms | 13 ms | 10 ms | 8 ms | 16 ms | 5 ms | 4 ms |
| `medium` | 33 ms | 11 ms | 10 ms | 9 ms | 14 ms | 6 ms | 5 ms |
| `large` | 39 ms | 17 ms | 20 ms | 18 ms | 40 ms | 14 ms | 23 ms |
| `xlarge` | 49 ms | 47 ms | 48 ms | 30 ms | 172 ms | 13 ms | 63 ms |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
