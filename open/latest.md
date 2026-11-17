# File open benchmark

- Recorded: 2026-11-17T08:49:01.367Z, commit `2bbc0d54fc6d`, diode nightly-2bbc0d5
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 21 ms; binary floor (`diode --version` over PTY, median): 62 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **135 ms** | 95 ms | 156 ms | 245 ms | 9 ms | 284 MB | 11 |
| `medium` | 126.7 KB | 2000 | **131 ms** | 90 ms | 152 ms | 244 ms | 8 ms | 293 MB | 11 |
| `large` | 1.3 MB | 20000 | **150 ms** | 110 ms | 172 ms | 257 ms | 7 ms | 304 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **214 ms** | 174 ms | 235 ms | 312 ms | 22 ms | 362 MB | 5 |
| `log500m` | 497 MB | 5295839 | **139 ms** | 99 ms | 160 ms | — (plaintext) | 2 ms | 320 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 6 ms | 7 ms | 7 ms | 5 ms |
| node ready (bootstrapComplete) | 64 ms | 64 ms | 69 ms | 73 ms | 58 ms |
| bundle executed (main:start) | 64 ms | 64 ms | 69 ms | 74 ms | 58 ms |
| config loaded | 80 ms | 82 ms | 86 ms | 95 ms | 80 ms |
| keybindings loaded | 82 ms | 82 ms | 86 ms | 95 ms | 80 ms |
| session state loaded | 82 ms | 82 ms | 86 ms | 95 ms | 80 ms |
| extensions scanned | 76 ms | 77 ms | 83 ms | 91 ms | 74 ms |
| themes ready | 87 ms | 86 ms | 90 ms | 100 ms | 83 ms |
| DI container created | 90 ms | 89 ms | 94 ms | 103 ms | 86 ms |
| workbench mounted | 121 ms | 119 ms | 127 ms | 140 ms | 114 ms |
| first frame | 121 ms | 119 ms | 126 ms | 140 ms | 114 ms |
| workbench activated | 128 ms | 125 ms | 135 ms | 146 ms | 120 ms |
| grammars preloaded | 136 ms | 129 ms | 138 ms | 149 ms | 122 ms |
| file read from disk | 138 ms | 131 ms | 149 ms | 216 ms | 131 ms |
| file decoded | 138 ms | 131 ms | 149 ms | 216 ms | 131 ms |
| document built | 138 ms | 132 ms | 149 ms | 216 ms | 131 ms |
| tokenizer attached to editor | 156 ms | 153 ms | 171 ms | 237 ms | — |
| tabs opened | 142 ms | 137 ms | 157 ms | 224 ms | 147 ms |
| built-in extensions registered | 271 ms | 269 ms | 280 ms | 333 ms | 196 ms |
| frame with file text | 155 ms | 151 ms | 169 ms | 235 ms | 160 ms |
| frame with highlighting | 245 ms | 244 ms | 257 ms | 312 ms | — |
| extension host up | 463 ms | 494 ms | 570 ms | 926 ms | 355 ms |
| startup complete | 264 ms | 261 ms | 272 ms | 326 ms | 188 ms |
| to text (black box) | 156 ms | 152 ms | 172 ms | 235 ms | 160 ms |
| to highlight (black box) | 245 ms | 244 ms | 257 ms | 312 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 2 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 32 ms | 14 ms | 11 ms | 9 ms | — | 5 ms | 3 ms |
| `medium` failed | 24 ms | 12 ms | 9 ms | 11 ms | — | 7 ms | 4 ms |
| `large` failed | 36 ms | 22 ms | 16 ms | 13 ms | — | 14 ms | 19 ms |
| `xlarge` failed | 43 ms | 42 ms | 26 ms | 25 ms | — | 15 ms | 64 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
