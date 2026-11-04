# File open benchmark

- Recorded: 2026-11-04T00:25:13.881Z, commit `36ac0dfd3f25`, diode nightly-36ac0df
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 25 ms; binary floor (`diode --version` over PTY, median): 64 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **147 ms** | 109 ms | 173 ms | 288 ms | 15 ms | 265 MB | 11 |
| `medium` | 126.7 KB | 2000 | **148 ms** | 109 ms | 173 ms | 291 ms | 8 ms | 281 MB | 11 |
| `large` | 1.3 MB | 20000 | **164 ms** | 125 ms | 189 ms | 304 ms | 5 ms | 293 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **266 ms** | 228 ms | 292 ms | 391 ms | 17 ms | 342 MB | 5 |
| `log500m` | 497 MB | 5295839 | **161 ms** | 123 ms | 186 ms | — (plaintext) | 6 ms | 305 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 8 ms | 9 ms | 6 ms |
| node ready (bootstrapComplete) | 71 ms | 69 ms | 74 ms | 86 ms | 66 ms |
| bundle executed (main:start) | 71 ms | 69 ms | 74 ms | 86 ms | 66 ms |
| config loaded | 89 ms | 87 ms | 95 ms | 103 ms | 88 ms |
| keybindings loaded | 91 ms | 89 ms | 96 ms | 105 ms | 90 ms |
| session state loaded | 91 ms | 89 ms | 96 ms | 105 ms | 90 ms |
| extensions scanned | 84 ms | 83 ms | 89 ms | 99 ms | 84 ms |
| themes ready | 94 ms | 93 ms | 99 ms | 112 ms | 93 ms |
| DI container created | 98 ms | 97 ms | 104 ms | 117 ms | 96 ms |
| workbench mounted | 134 ms | 130 ms | 136 ms | 150 ms | 128 ms |
| first frame | 134 ms | 130 ms | 136 ms | 150 ms | 128 ms |
| workbench activated | 142 ms | 138 ms | 143 ms | 161 ms | 133 ms |
| grammars preloaded | 149 ms | 145 ms | 149 ms | 166 ms | 135 ms |
| file read from disk | 151 ms | 149 ms | 162 ms | 267 ms | 152 ms |
| file decoded | 151 ms | 149 ms | 162 ms | 267 ms | 152 ms |
| document built | 152 ms | 150 ms | 162 ms | 267 ms | 152 ms |
| tokenizer attached to editor | 171 ms | 172 ms | 189 ms | 293 ms | — |
| tabs opened | 156 ms | 156 ms | 172 ms | 278 ms | 172 ms |
| built-in extensions registered | 313 ms | 314 ms | 329 ms | 414 ms | 226 ms |
| frame with file text | 170 ms | 171 ms | 188 ms | 292 ms | 186 ms |
| frame with highlighting | 287 ms | 290 ms | 304 ms | 391 ms | — |
| extension host up | 565 ms | 597 ms | 670 ms | 1116 ms | 416 ms |
| startup complete | 307 ms | 308 ms | 323 ms | 408 ms | 220 ms |
| to text (black box) | 173 ms | 173 ms | 189 ms | 292 ms | 186 ms |
| to highlight (black box) | 288 ms | 291 ms | 304 ms | 391 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 1 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 33 ms | 12 ms | 11 ms | 9 ms | — | 8 ms | 5 ms |
| `medium` failed | 31 ms | 14 ms | 11 ms | 11 ms | — | 7 ms | 6 ms |
| `large` failed | 32 ms | 24 ms | 18 ms | 18 ms | — | 14 ms | 23 ms |
| `xlarge` failed | 39 ms | 34 ms | 22 ms | 25 ms | — | 14 ms | 94 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
