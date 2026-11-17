# File open benchmark

- Recorded: 2026-11-17T11:11:16.998Z, commit `a30f8306ed0a`, diode nightly-a30f830
- Machine: AMD EPYC 9V74 80-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 22 ms; binary floor (`diode --version` over PTY, median): 63 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **143 ms** | 102 ms | 165 ms | 252 ms | 4 ms | 285 MB | 11 |
| `medium` | 126.7 KB | 2000 | **152 ms** | 110 ms | 174 ms | 267 ms | 12 ms | 295 MB | 11 |
| `large` | 1.3 MB | 20000 | **155 ms** | 113 ms | 177 ms | 267 ms | 13 ms | 307 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **211 ms** | 170 ms | 233 ms | 311 ms | 12 ms | 360 MB | 5 |
| `log500m` | 497 MB | 5295839 | **144 ms** | 103 ms | 166 ms | — (plaintext) | 5 ms | 318 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 7 ms | 7 ms | 5 ms |
| node ready (bootstrapComplete) | 68 ms | 70 ms | 72 ms | 74 ms | 61 ms |
| bundle executed (main:start) | 68 ms | 71 ms | 72 ms | 74 ms | 61 ms |
| config loaded | 88 ms | 89 ms | 90 ms | 99 ms | 80 ms |
| keybindings loaded | 88 ms | 89 ms | 91 ms | 99 ms | 80 ms |
| session state loaded | 88 ms | 89 ms | 91 ms | 99 ms | 80 ms |
| extensions scanned | 82 ms | 83 ms | 86 ms | 91 ms | 73 ms |
| themes ready | 92 ms | 95 ms | 95 ms | 102 ms | 83 ms |
| DI container created | 94 ms | 97 ms | 97 ms | 105 ms | 86 ms |
| workbench mounted | 129 ms | 138 ms | 128 ms | 137 ms | 118 ms |
| first frame | 129 ms | 138 ms | 128 ms | 137 ms | 118 ms |
| workbench activated | 139 ms | 145 ms | 134 ms | 143 ms | 126 ms |
| grammars preloaded | 143 ms | 149 ms | 138 ms | 147 ms | 128 ms |
| file read from disk | 145 ms | 152 ms | 151 ms | 212 ms | 137 ms |
| file decoded | 145 ms | 152 ms | 151 ms | 212 ms | 137 ms |
| document built | 145 ms | 152 ms | 151 ms | 212 ms | 137 ms |
| tokenizer attached to editor | 163 ms | 174 ms | 176 ms | 235 ms | — |
| tabs opened | 149 ms | 159 ms | 160 ms | 219 ms | 152 ms |
| built-in extensions registered | 277 ms | 290 ms | 292 ms | 333 ms | 204 ms |
| frame with file text | 162 ms | 172 ms | 174 ms | 233 ms | 165 ms |
| frame with highlighting | 252 ms | 266 ms | 267 ms | 311 ms | — |
| extension host up | 483 ms | 541 ms | 576 ms | 931 ms | 358 ms |
| startup complete | 268 ms | 283 ms | 283 ms | 325 ms | 197 ms |
| to text (black box) | 165 ms | 174 ms | 177 ms | 233 ms | 166 ms |
| to highlight (black box) | 252 ms | 267 ms | 267 ms | 311 ms | — |
| gap black − white (text) | 2 ms | 1 ms | 2 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 31 ms | 14 ms | 10 ms | 12 ms | — | 6 ms | 3 ms |
| `medium` failed | 32 ms | 16 ms | 11 ms | 9 ms | — | 6 ms | 5 ms |
| `large` failed | 40 ms | 26 ms | 19 ms | 20 ms | — | 16 ms | 20 ms |
| `xlarge` failed | 29 ms | 26 ms | 16 ms | 15 ms | — | 13 ms | 67 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
