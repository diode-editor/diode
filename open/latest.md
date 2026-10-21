# File open benchmark

- Recorded: 2026-10-21T21:24:25.242Z, commit `49e438fd97f5`, diode nightly-49e438f
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 24 ms; binary floor (`diode --version` over PTY, median): 59 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **140 ms** | 105 ms | 164 ms | 282 ms | 11 ms | 243 MB | 11 |
| `medium` | 126.7 KB | 2000 | **168 ms** | 132 ms | 192 ms | 311 ms | 5 ms | 270 MB | 11 |
| `large` | 1.3 MB | 20000 | **320 ms** | 284 ms | 344 ms | 458 ms | 19 ms | 298 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **1704 ms** | 1668 ms | 1728 ms | 1890 ms | 133 ms | 501 MB | 5 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` |
| --- | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 7 ms | 9 ms |
| node ready (bootstrapComplete) | 64 ms | 65 ms | 65 ms | 86 ms |
| bundle executed (main:start) | 64 ms | 65 ms | 65 ms | 86 ms |
| config loaded | 81 ms | 81 ms | 84 ms | 108 ms |
| keybindings loaded | 82 ms | 84 ms | 85 ms | 109 ms |
| session state loaded | 82 ms | 84 ms | 85 ms | 110 ms |
| extensions scanned | 78 ms | 78 ms | 78 ms | 102 ms |
| themes ready | 85 ms | 87 ms | 87 ms | 114 ms |
| DI container created | 90 ms | 92 ms | 92 ms | 118 ms |
| workbench mounted | 122 ms | 120 ms | 123 ms | 147 ms |
| first frame | 122 ms | 120 ms | 123 ms | 147 ms |
| workbench activated | 128 ms | 125 ms | 129 ms | 152 ms |
| grammars preloaded | 138 ms | 131 ms | 139 ms | 157 ms |
| file read from disk | 139 ms | 134 ms | 152 ms | 250 ms |
| file decoded | 139 ms | 134 ms | 152 ms | 251 ms |
| document built | 140 ms | 135 ms | 153 ms | 251 ms |
| tokenizer attached to editor | 163 ms | 193 ms | 345 ms | 1729 ms |
| tabs opened | 145 ms | 146 ms | 171 ms | 292 ms |
| built-in extensions registered | 302 ms | 332 ms | 477 ms | 1908 ms |
| frame with file text | 163 ms | 191 ms | 343 ms | 1728 ms |
| frame with highlighting | 282 ms | 310 ms | 458 ms | 1890 ms |
| extension host up | 548 ms | 572 ms | 766 ms | 2491 ms |
| startup complete | 297 ms | 326 ms | 472 ms | 1904 ms |
| to text (black box) | 164 ms | 192 ms | 344 ms | 1728 ms |
| to highlight (black box) | 282 ms | 311 ms | 458 ms | 1890 ms |
| gap black − white (text) | 1 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 47 ms | 14 ms | 15 ms | 11 ms | 18 ms | 9 ms | 6 ms |
| `medium` | 40 ms | 18 ms | 14 ms | 12 ms | 16 ms | 5 ms | 7 ms |
| `large` | 72 ms | 60 ms | 41 ms | 76 ms | 48 ms | 14 ms | 14 ms |
| `xlarge` | 236 ms | 474 ms | 422 ms | 384 ms | 224 ms | 11 ms | 65 ms |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
