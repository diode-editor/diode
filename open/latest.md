# File open benchmark

- Recorded: 2026-10-23T13:33:58.660Z, commit `cc4666659c42`, diode nightly-cc46666
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 28 ms; binary floor (`diode --version` over PTY, median): 62 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **138 ms** | 103 ms | 165 ms | 281 ms | 5 ms | 244 MB | 11 |
| `medium` | 126.7 KB | 2000 | **143 ms** | 109 ms | 171 ms | 286 ms | 11 ms | 268 MB | 11 |
| `large` | 1.3 MB | 20000 | **151 ms** | 117 ms | 179 ms | 299 ms | 17 ms | 306 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **249 ms** | 214 ms | 276 ms | 383 ms | 7 ms | 676 MB | 5 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` |
| --- | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 10 ms | 11 ms |
| node ready (bootstrapComplete) | 67 ms | 68 ms | 69 ms | 87 ms |
| bundle executed (main:start) | 67 ms | 68 ms | 69 ms | 87 ms |
| config loaded | 83 ms | 86 ms | 85 ms | 104 ms |
| keybindings loaded | 84 ms | 86 ms | 89 ms | 104 ms |
| session state loaded | 84 ms | 87 ms | 89 ms | 104 ms |
| extensions scanned | 79 ms | 83 ms | 82 ms | 102 ms |
| themes ready | 88 ms | 92 ms | 92 ms | 108 ms |
| DI container created | 93 ms | 95 ms | 96 ms | 112 ms |
| workbench mounted | 128 ms | 132 ms | 127 ms | 146 ms |
| first frame | 128 ms | 132 ms | 127 ms | 146 ms |
| workbench activated | 134 ms | 138 ms | 133 ms | 151 ms |
| grammars preloaded | 142 ms | 145 ms | 143 ms | 162 ms |
| file read from disk | 144 ms | 147 ms | 155 ms | 250 ms |
| file decoded | 144 ms | 147 ms | 155 ms | 250 ms |
| document built | 144 ms | 147 ms | 155 ms | 250 ms |
| tokenizer attached to editor | 164 ms | 172 ms | 180 ms | 277 ms |
| tabs opened | 148 ms | 154 ms | 164 ms | 260 ms |
| built-in extensions registered | 306 ms | 308 ms | 323 ms | 402 ms |
| frame with file text | 163 ms | 170 ms | 178 ms | 276 ms |
| frame with highlighting | 282 ms | 285 ms | 299 ms | 383 ms |
| extension host up | 548 ms | 583 ms | 665 ms | 1341 ms |
| startup complete | 299 ms | 302 ms | 317 ms | 398 ms |
| to text (black box) | 165 ms | 171 ms | 179 ms | 276 ms |
| to highlight (black box) | 281 ms | 286 ms | 299 ms | 383 ms |
| gap black − white (text) | 2 ms | 1 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 36 ms | 12 ms | 8 ms | 8 ms | 14 ms | 5 ms | 5 ms |
| `medium` | 32 ms | 11 ms | 11 ms | 9 ms | 12 ms | 9 ms | 5 ms |
| `large` | 33 ms | 18 ms | 21 ms | 25 ms | 41 ms | 14 ms | 17 ms |
| `xlarge` | 92 ms | 44 ms | 20 ms | 20 ms | 187 ms | 14 ms | 76 ms |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
