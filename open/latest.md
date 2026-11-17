# File open benchmark

- Recorded: 2026-11-17T21:32:17.841Z, commit `3334c48ba677`, diode nightly-3334c48
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 24 ms; binary floor (`diode --version` over PTY, median): 71 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **165 ms** | 118 ms | 189 ms | 306 ms | 10 ms | 286 MB | 11 |
| `medium` | 126.7 KB | 2000 | **173 ms** | 125 ms | 196 ms | 313 ms | 11 ms | 295 MB | 11 |
| `large` | 1.3 MB | 20000 | **197 ms** | 149 ms | 220 ms | 330 ms | 7 ms | 304 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **287 ms** | 240 ms | 310 ms | 411 ms | 10 ms | 361 MB | 5 |
| `log500m` | 497 MB | 5295839 | **181 ms** | 133 ms | 204 ms | — (plaintext) | 4 ms | 317 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 9 ms | 14 ms | 6 ms |
| node ready (bootstrapComplete) | 76 ms | 77 ms | 83 ms | 103 ms | 72 ms |
| bundle executed (main:start) | 76 ms | 77 ms | 83 ms | 103 ms | 72 ms |
| config loaded | 97 ms | 98 ms | 104 ms | 128 ms | 96 ms |
| keybindings loaded | 100 ms | 99 ms | 106 ms | 128 ms | 96 ms |
| session state loaded | 100 ms | 99 ms | 106 ms | 128 ms | 96 ms |
| extensions scanned | 91 ms | 92 ms | 98 ms | 119 ms | 89 ms |
| themes ready | 103 ms | 103 ms | 110 ms | 132 ms | 100 ms |
| DI container created | 107 ms | 107 ms | 114 ms | 135 ms | 104 ms |
| workbench mounted | 149 ms | 154 ms | 161 ms | 177 ms | 145 ms |
| first frame | 149 ms | 154 ms | 161 ms | 177 ms | 145 ms |
| workbench activated | 158 ms | 162 ms | 169 ms | 185 ms | 153 ms |
| grammars preloaded | 163 ms | 168 ms | 173 ms | 190 ms | 156 ms |
| file read from disk | 166 ms | 173 ms | 190 ms | 281 ms | 167 ms |
| file decoded | 166 ms | 173 ms | 190 ms | 281 ms | 167 ms |
| document built | 166 ms | 173 ms | 191 ms | 281 ms | 167 ms |
| tokenizer attached to editor | 189 ms | 197 ms | 222 ms | 312 ms | — |
| tabs opened | 171 ms | 180 ms | 202 ms | 291 ms | 188 ms |
| built-in extensions registered | 335 ms | 341 ms | 362 ms | 439 ms | 254 ms |
| frame with file text | 188 ms | 195 ms | 220 ms | 310 ms | 204 ms |
| frame with highlighting | 303 ms | 313 ms | 330 ms | 411 ms | — |
| extension host up | 590 ms | 635 ms | 716 ms | 1154 ms | 452 ms |
| startup complete | 325 ms | 332 ms | 353 ms | 430 ms | 244 ms |
| to text (black box) | 189 ms | 196 ms | 220 ms | 310 ms | 204 ms |
| to highlight (black box) | 306 ms | 313 ms | 330 ms | 411 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 1 ms | 0 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 37 ms | 17 ms | 12 ms | 12 ms | — | 8 ms | 3 ms |
| `medium` failed | 32 ms | 15 ms | 13 ms | 10 ms | — | 8 ms | 6 ms |
| `large` failed | 39 ms | 26 ms | 21 ms | 24 ms | — | 17 ms | 22 ms |
| `xlarge` failed | 28 ms | 30 ms | 23 ms | 23 ms | — | 14 ms | 87 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
