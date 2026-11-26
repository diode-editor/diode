# File open benchmark

- Recorded: 2026-11-26T21:34:53.196Z, commit `fd3e64220051`, diode nightly-fd3e642
- Machine: Intel(R) Xeon(R) Platinum 8370C CPU @ 2.80GHz (4 cores, 16 GB), linux 7.0.0-1020-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 23 ms; binary floor (`diode --version` over PTY, median): 70 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **170 ms** | 123 ms | 193 ms | 310 ms | 6 ms | 298 MB | 11 |
| `medium` | 126.7 KB | 2000 | **179 ms** | 132 ms | 202 ms | 326 ms | 21 ms | 304 MB | 11 |
| `large` | 1.3 MB | 20000 | **185 ms** | 138 ms | 208 ms | 321 ms | 18 ms | 316 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **271 ms** | 223 ms | 294 ms | 393 ms | 6 ms | 367 MB | 5 |
| `log500m` | 497 MB | 5295839 | **182 ms** | 135 ms | 205 ms | — (plaintext) | 4 ms | 339 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 7 ms | 6 ms | 8 ms | 5 ms |
| node ready (bootstrapComplete) | 73 ms | 75 ms | 75 ms | 85 ms | 71 ms |
| bundle executed (main:start) | 73 ms | 75 ms | 75 ms | 85 ms | 71 ms |
| config loaded | 95 ms | 101 ms | 96 ms | 106 ms | 98 ms |
| keybindings loaded | 95 ms | 101 ms | 99 ms | 107 ms | 98 ms |
| session state loaded | 96 ms | 101 ms | 99 ms | 107 ms | 98 ms |
| extensions scanned | 89 ms | 94 ms | 90 ms | 101 ms | 91 ms |
| themes ready | 101 ms | 107 ms | 104 ms | 114 ms | 104 ms |
| DI container created | 105 ms | 112 ms | 107 ms | 117 ms | 108 ms |
| workbench mounted | 153 ms | 157 ms | 154 ms | 162 ms | 149 ms |
| first frame | 153 ms | 157 ms | 154 ms | 162 ms | 149 ms |
| workbench activated | 161 ms | 165 ms | 162 ms | 169 ms | 156 ms |
| grammars preloaded | 167 ms | 170 ms | 169 ms | 174 ms | 158 ms |
| file read from disk | 170 ms | 175 ms | 180 ms | 267 ms | 168 ms |
| file decoded | 170 ms | 175 ms | 180 ms | 267 ms | 168 ms |
| document built | 171 ms | 175 ms | 181 ms | 267 ms | 168 ms |
| tokenizer attached to editor | 192 ms | 203 ms | 207 ms | 296 ms | — |
| tabs opened | 175 ms | 184 ms | 190 ms | 277 ms | 189 ms |
| built-in extensions registered | 344 ms | 355 ms | 353 ms | 422 ms | 252 ms |
| frame with file text | 191 ms | 201 ms | 205 ms | 294 ms | 205 ms |
| frame with highlighting | 310 ms | 325 ms | 321 ms | 393 ms | — |
| extension host up | 586 ms | 632 ms | 673 ms | 1124 ms | 447 ms |
| startup complete | 331 ms | 342 ms | 341 ms | 409 ms | 239 ms |
| to text (black box) | 193 ms | 202 ms | 208 ms | 294 ms | 205 ms |
| to highlight (black box) | 310 ms | 326 ms | 321 ms | 393 ms | — |
| gap black − white (text) | 2 ms | 1 ms | 1 ms | 0 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 36 ms | 18 ms | 13 ms | 11 ms | — | 10 ms | 4 ms |
| `medium` failed | 36 ms | 19 ms | 12 ms | 12 ms | — | 7 ms | 11 ms |
| `large` failed | 37 ms | 29 ms | 24 ms | 27 ms | — | 17 ms | 20 ms |
| `xlarge` failed | 37 ms | 38 ms | 19 ms | 22 ms | — | 17 ms | 105 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
