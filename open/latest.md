# File open benchmark

- Recorded: 2026-11-16T17:58:01.444Z, commit `522b0e9a08e1`, diode nightly-522b0e9
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 24 ms; binary floor (`diode --version` over PTY, median): 69 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **166 ms** | 121 ms | 190 ms | 305 ms | 23 ms | 284 MB | 11 |
| `medium` | 126.7 KB | 2000 | **166 ms** | 121 ms | 190 ms | 305 ms | 9 ms | 293 MB | 11 |
| `large` | 1.3 MB | 20000 | **186 ms** | 140 ms | 210 ms | 324 ms | 5 ms | 302 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **276 ms** | 230 ms | 300 ms | 394 ms | 13 ms | 359 MB | 5 |
| `log500m` | 497 MB | 5295839 | **182 ms** | 136 ms | 205 ms | — (plaintext) | 17 ms | 311 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 7 ms | 8 ms | 8 ms | 6 ms |
| node ready (bootstrapComplete) | 76 ms | 75 ms | 78 ms | 91 ms | 72 ms |
| bundle executed (main:start) | 76 ms | 75 ms | 78 ms | 91 ms | 72 ms |
| config loaded | 97 ms | 96 ms | 95 ms | 116 ms | 96 ms |
| keybindings loaded | 97 ms | 97 ms | 95 ms | 117 ms | 97 ms |
| session state loaded | 97 ms | 97 ms | 95 ms | 117 ms | 97 ms |
| extensions scanned | 90 ms | 89 ms | 90 ms | 111 ms | 93 ms |
| themes ready | 102 ms | 102 ms | 101 ms | 121 ms | 100 ms |
| DI container created | 105 ms | 105 ms | 107 ms | 124 ms | 104 ms |
| workbench mounted | 152 ms | 147 ms | 156 ms | 163 ms | 144 ms |
| first frame | 152 ms | 147 ms | 156 ms | 163 ms | 144 ms |
| workbench activated | 159 ms | 155 ms | 163 ms | 171 ms | 151 ms |
| grammars preloaded | 165 ms | 160 ms | 168 ms | 176 ms | 154 ms |
| file read from disk | 169 ms | 164 ms | 182 ms | 271 ms | 167 ms |
| file decoded | 169 ms | 164 ms | 182 ms | 271 ms | 167 ms |
| document built | 169 ms | 164 ms | 182 ms | 272 ms | 167 ms |
| tokenizer attached to editor | 191 ms | 191 ms | 209 ms | 301 ms | — |
| tabs opened | 174 ms | 170 ms | 192 ms | 282 ms | 187 ms |
| built-in extensions registered | 334 ms | 333 ms | 352 ms | 424 ms | 254 ms |
| frame with file text | 190 ms | 189 ms | 207 ms | 299 ms | 203 ms |
| frame with highlighting | 305 ms | 304 ms | 324 ms | 394 ms | — |
| extension host up | 588 ms | 616 ms | 707 ms | 1143 ms | 464 ms |
| startup complete | 325 ms | 323 ms | 342 ms | 413 ms | 244 ms |
| to text (black box) | 190 ms | 190 ms | 210 ms | 300 ms | 205 ms |
| to highlight (black box) | 305 ms | 305 ms | 324 ms | 394 ms | — |
| gap black − white (text) | 1 ms | 1 ms | 1 ms | 2 ms | 3 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 33 ms | 15 ms | 15 ms | 10 ms | — | 6 ms | 4 ms |
| `medium` failed | 31 ms | 15 ms | 12 ms | 10 ms | — | 8 ms | 5 ms |
| `large` failed | 31 ms | 24 ms | 26 ms | 26 ms | — | 18 ms | 23 ms |
| `xlarge` failed | 27 ms | 40 ms | 24 ms | 28 ms | — | 14 ms | 69 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
