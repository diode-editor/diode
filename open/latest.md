# File open benchmark

- Recorded: 2026-11-25T23:12:17.572Z, commit `ac8e3503277d`, diode nightly-ac8e350
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1020-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 22 ms; binary floor (`diode --version` over PTY, median): 68 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **158 ms** | 112 ms | 179 ms | 276 ms | 6 ms | 296 MB | 11 |
| `medium` | 126.7 KB | 2000 | **156 ms** | 110 ms | 178 ms | 274 ms | 10 ms | 302 MB | 11 |
| `large` | 1.3 MB | 20000 | **166 ms** | 120 ms | 188 ms | 281 ms | 10 ms | 315 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **231 ms** | 185 ms | 253 ms | 333 ms | 12 ms | 369 MB | 5 |
| `log500m` | 497 MB | 5295839 | **153 ms** | 107 ms | 175 ms | — (plaintext) | 8 ms | 349 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 7 ms | 8 ms | 5 ms |
| node ready (bootstrapComplete) | 73 ms | 71 ms | 74 ms | 78 ms | 65 ms |
| bundle executed (main:start) | 73 ms | 71 ms | 74 ms | 78 ms | 65 ms |
| config loaded | 98 ms | 91 ms | 96 ms | 104 ms | 86 ms |
| keybindings loaded | 99 ms | 92 ms | 96 ms | 104 ms | 87 ms |
| session state loaded | 99 ms | 92 ms | 97 ms | 104 ms | 87 ms |
| extensions scanned | 90 ms | 86 ms | 93 ms | 97 ms | 79 ms |
| themes ready | 102 ms | 98 ms | 100 ms | 108 ms | 91 ms |
| DI container created | 105 ms | 101 ms | 103 ms | 111 ms | 94 ms |
| workbench mounted | 146 ms | 141 ms | 141 ms | 148 ms | 129 ms |
| first frame | 146 ms | 141 ms | 141 ms | 147 ms | 129 ms |
| workbench activated | 153 ms | 147 ms | 147 ms | 154 ms | 135 ms |
| grammars preloaded | 158 ms | 152 ms | 151 ms | 159 ms | 137 ms |
| file read from disk | 161 ms | 155 ms | 164 ms | 229 ms | 145 ms |
| file decoded | 161 ms | 155 ms | 164 ms | 229 ms | 145 ms |
| document built | 161 ms | 155 ms | 164 ms | 230 ms | 145 ms |
| tokenizer attached to editor | 179 ms | 178 ms | 187 ms | 253 ms | — |
| tabs opened | 165 ms | 162 ms | 171 ms | 237 ms | 162 ms |
| built-in extensions registered | 304 ms | 302 ms | 307 ms | 359 ms | 217 ms |
| frame with file text | 178 ms | 176 ms | 185 ms | 252 ms | 175 ms |
| frame with highlighting | 276 ms | 273 ms | 281 ms | 333 ms | — |
| extension host up | 524 ms | 564 ms | 607 ms | 984 ms | 385 ms |
| startup complete | 294 ms | 291 ms | 298 ms | 349 ms | 207 ms |
| to text (black box) | 179 ms | 178 ms | 188 ms | 253 ms | 175 ms |
| to highlight (black box) | 276 ms | 274 ms | 281 ms | 333 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 28 ms | 14 ms | 11 ms | 11 ms | — | 8 ms | 3 ms |
| `medium` failed | 27 ms | 16 ms | 10 ms | 13 ms | — | 6 ms | 5 ms |
| `large` failed | 28 ms | 27 ms | 24 ms | 20 ms | — | 14 ms | 14 ms |
| `xlarge` failed | 46 ms | 42 ms | 21 ms | 31 ms | — | 11 ms | 61 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
