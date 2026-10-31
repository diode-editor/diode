# File open benchmark

- Recorded: 2026-10-31T18:35:08.605Z, commit `568c0744d5ec`, diode nightly-568c074
- Machine: AMD EPYC 9V45 96-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 17 ms; binary floor (`diode --version` over PTY, median): 42 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **89 ms** | 63 ms | 105 ms | 176 ms | 5 ms | 262 MB | 11 |
| `medium` | 126.7 KB | 2000 | **98 ms** | 72 ms | 114 ms | 192 ms | 6 ms | 281 MB | 11 |
| `large` | 1.3 MB | 20000 | **120 ms** | 94 ms | 137 ms | 223 ms | 7 ms | 298 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **178 ms** | 152 ms | 194 ms | 286 ms | 16 ms | 381 MB | 5 |
| `log500m` | 497 MB | 5295839 | **106 ms** | 80 ms | 122 ms | — (plaintext) | 30 ms ⚠ noisy | 314 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 8 ms | 8 ms | 5 ms |
| node ready (bootstrapComplete) | 46 ms | 50 ms | 58 ms | 68 ms | 46 ms |
| bundle executed (main:start) | 46 ms | 50 ms | 58 ms | 68 ms | 46 ms |
| config loaded | 61 ms | 63 ms | 73 ms | 83 ms | 60 ms |
| keybindings loaded | 61 ms | 63 ms | 73 ms | 84 ms | 61 ms |
| session state loaded | 61 ms | 64 ms | 73 ms | 84 ms | 61 ms |
| extensions scanned | 58 ms | 61 ms | 71 ms | 81 ms | 58 ms |
| themes ready | 63 ms | 66 ms | 76 ms | 86 ms | 66 ms |
| DI container created | 65 ms | 69 ms | 79 ms | 88 ms | 68 ms |
| workbench mounted | 83 ms | 87 ms | 100 ms | 110 ms | 88 ms |
| first frame | 83 ms | 87 ms | 100 ms | 110 ms | 88 ms |
| workbench activated | 85 ms | 91 ms | 104 ms | 113 ms | 91 ms |
| grammars preloaded | 91 ms | 96 ms | 111 ms | 117 ms | 93 ms |
| file read from disk | 93 ms | 98 ms | 119 ms | 176 ms | 100 ms |
| file decoded | 93 ms | 98 ms | 119 ms | 176 ms | 100 ms |
| document built | 93 ms | 99 ms | 119 ms | 176 ms | 100 ms |
| tokenizer attached to editor | 106 ms | 117 ms | 151 ms | 210 ms | — |
| tabs opened | 96 ms | 102 ms | 125 ms | 184 ms | 113 ms |
| built-in extensions registered | 196 ms | 211 ms | 243 ms | 303 ms | 151 ms |
| frame with file text | 104 ms | 112 ms | 135 ms | 193 ms | 122 ms |
| frame with highlighting | 176 ms | 191 ms | 223 ms | 286 ms | — |
| extension host up | 346 ms | 370 ms | 467 ms | 773 ms | 322 ms |
| startup complete | 192 ms | 206 ms | 238 ms | 299 ms | 146 ms |
| to text (black box) | 105 ms | 114 ms | 137 ms | 194 ms | 122 ms |
| to highlight (black box) | 176 ms | 192 ms | 223 ms | 286 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 2 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 12 ms | 5 ms | 5 ms | 4 ms | 8 ms | 3 ms | 3 ms |
| `medium` | 19 ms | 10 ms | 9 ms | 5 ms | 13 ms | 3 ms | 3 ms |
| `large` | 30 ms | 19 ms | 20 ms | 13 ms | 46 ms | 9 ms | 13 ms |
| `xlarge` | 22 ms | 26 ms | 17 ms | 18 ms | 181 ms | 21 ms | 43 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
