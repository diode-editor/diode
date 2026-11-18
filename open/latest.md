# File open benchmark

- Recorded: 2026-11-18T21:14:58.633Z, commit `d73c810aea60`, diode nightly-d73c810
- Machine: Intel(R) Xeon(R) Platinum 8370C CPU @ 2.80GHz (4 cores, 16 GB), linux 7.0.0-1020-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 22 ms; binary floor (`diode --version` over PTY, median): 69 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **170 ms** | 124 ms | 192 ms | 308 ms | 11 ms | 293 MB | 11 |
| `medium` | 126.7 KB | 2000 | **174 ms** | 127 ms | 196 ms | 313 ms | 5 ms | 301 MB | 11 |
| `large` | 1.3 MB | 20000 | **179 ms** | 132 ms | 201 ms | 320 ms | 11 ms | 311 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **258 ms** | 211 ms | 280 ms | 376 ms | 7 ms | 363 MB | 5 |
| `log500m` | 497 MB | 5295839 | **185 ms** | 138 ms | 207 ms | — (plaintext) | 10 ms | 338 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 6 ms | 6 ms | 9 ms | 4 ms |
| node ready (bootstrapComplete) | 78 ms | 74 ms | 73 ms | 87 ms | 70 ms |
| bundle executed (main:start) | 78 ms | 74 ms | 73 ms | 87 ms | 70 ms |
| config loaded | 102 ms | 96 ms | 95 ms | 110 ms | 93 ms |
| keybindings loaded | 105 ms | 96 ms | 98 ms | 113 ms | 93 ms |
| session state loaded | 105 ms | 96 ms | 98 ms | 113 ms | 94 ms |
| extensions scanned | 95 ms | 89 ms | 89 ms | 103 ms | 87 ms |
| themes ready | 109 ms | 100 ms | 102 ms | 117 ms | 98 ms |
| DI container created | 113 ms | 105 ms | 105 ms | 120 ms | 102 ms |
| workbench mounted | 152 ms | 151 ms | 144 ms | 158 ms | 143 ms |
| first frame | 152 ms | 151 ms | 144 ms | 158 ms | 143 ms |
| workbench activated | 160 ms | 158 ms | 151 ms | 164 ms | 149 ms |
| grammars preloaded | 164 ms | 164 ms | 156 ms | 170 ms | 152 ms |
| file read from disk | 167 ms | 169 ms | 175 ms | 253 ms | 166 ms |
| file decoded | 167 ms | 169 ms | 175 ms | 253 ms | 166 ms |
| document built | 167 ms | 169 ms | 176 ms | 253 ms | 166 ms |
| tokenizer attached to editor | 191 ms | 195 ms | 203 ms | 281 ms | — |
| tabs opened | 172 ms | 176 ms | 186 ms | 263 ms | 186 ms |
| built-in extensions registered | 340 ms | 345 ms | 349 ms | 404 ms | 258 ms |
| frame with file text | 190 ms | 193 ms | 201 ms | 279 ms | 206 ms |
| frame with highlighting | 308 ms | 313 ms | 320 ms | 376 ms | — |
| extension host up | 580 ms | 617 ms | 687 ms | 1134 ms | 442 ms |
| startup complete | 327 ms | 331 ms | 336 ms | 393 ms | 242 ms |
| to text (black box) | 192 ms | 196 ms | 201 ms | 280 ms | 207 ms |
| to highlight (black box) | 308 ms | 313 ms | 320 ms | 376 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 2 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 33 ms | 14 ms | 13 ms | 10 ms | — | 7 ms | 4 ms |
| `medium` failed | 32 ms | 17 ms | 12 ms | 15 ms | — | 6 ms | 8 ms |
| `large` failed | 36 ms | 24 ms | 22 ms | 20 ms | — | 16 ms | 27 ms |
| `xlarge` failed | 29 ms | 27 ms | 19 ms | 22 ms | — | 16 ms | 95 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
