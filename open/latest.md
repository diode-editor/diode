# File open benchmark

- Recorded: 2026-11-25T03:36:06.852Z, commit `6f5a2acd32a5`, diode nightly-6f5a2ac
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1020-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 24 ms; binary floor (`diode --version` over PTY, median): 74 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **180 ms** | 130 ms | 204 ms | 319 ms | 8 ms | 295 MB | 11 |
| `medium` | 126.7 KB | 2000 | **183 ms** | 133 ms | 207 ms | 323 ms | 8 ms | 303 MB | 11 |
| `large` | 1.3 MB | 20000 | **202 ms** | 152 ms | 226 ms | 345 ms | 7 ms | 314 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **292 ms** | 242 ms | 316 ms | 422 ms | 21 ms | 362 MB | 5 |
| `log500m` | 497 MB | 5295839 | **189 ms** | 139 ms | 213 ms | — (plaintext) | 4 ms | 342 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 7 ms | 7 ms | 11 ms | 5 ms |
| node ready (bootstrapComplete) | 78 ms | 80 ms | 85 ms | 103 ms | 74 ms |
| bundle executed (main:start) | 78 ms | 80 ms | 85 ms | 103 ms | 74 ms |
| config loaded | 103 ms | 103 ms | 107 ms | 126 ms | 99 ms |
| keybindings loaded | 104 ms | 104 ms | 107 ms | 127 ms | 99 ms |
| session state loaded | 104 ms | 104 ms | 108 ms | 127 ms | 99 ms |
| extensions scanned | 96 ms | 96 ms | 103 ms | 119 ms | 92 ms |
| themes ready | 110 ms | 110 ms | 115 ms | 132 ms | 103 ms |
| DI container created | 113 ms | 114 ms | 118 ms | 136 ms | 107 ms |
| workbench mounted | 163 ms | 163 ms | 171 ms | 180 ms | 150 ms |
| first frame | 163 ms | 163 ms | 171 ms | 180 ms | 150 ms |
| workbench activated | 172 ms | 171 ms | 179 ms | 187 ms | 157 ms |
| grammars preloaded | 177 ms | 177 ms | 185 ms | 193 ms | 160 ms |
| file read from disk | 180 ms | 181 ms | 198 ms | 288 ms | 173 ms |
| file decoded | 180 ms | 181 ms | 198 ms | 288 ms | 173 ms |
| document built | 181 ms | 181 ms | 198 ms | 288 ms | 173 ms |
| tokenizer attached to editor | 204 ms | 207 ms | 226 ms | 317 ms | — |
| tabs opened | 186 ms | 189 ms | 209 ms | 299 ms | 195 ms |
| built-in extensions registered | 356 ms | 362 ms | 379 ms | 455 ms | 269 ms |
| frame with file text | 203 ms | 205 ms | 224 ms | 316 ms | 212 ms |
| frame with highlighting | 319 ms | 322 ms | 344 ms | 421 ms | — |
| extension host up | 618 ms | 674 ms | 741 ms | 1172 ms | 464 ms |
| startup complete | 344 ms | 349 ms | 366 ms | 443 ms | 253 ms |
| to text (black box) | 204 ms | 207 ms | 226 ms | 316 ms | 213 ms |
| to highlight (black box) | 319 ms | 323 ms | 345 ms | 422 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 1 ms | 1 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 40 ms | 17 ms | 12 ms | 10 ms | — | 9 ms | 5 ms |
| `medium` failed | 28 ms | 16 ms | 13 ms | 14 ms | — | 8 ms | 7 ms |
| `large` failed | 43 ms | 26 ms | 33 ms | 22 ms | — | 17 ms | 26 ms |
| `xlarge` failed | 25 ms | 27 ms | 15 ms | 17 ms | — | 17 ms | 84 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
