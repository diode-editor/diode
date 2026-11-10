# File open benchmark

- Recorded: 2026-11-10T03:28:04.803Z, commit `0f4aa7bacf7a`, diode nightly-0f4aa7b
- Machine: AMD EPYC 7763 64-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 23 ms; binary floor (`diode --version` over PTY, median): 64 ms; for reference `node --version`: 4 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **155 ms** | 114 ms | 179 ms | 288 ms | 10 ms | 278 MB | 11 |
| `medium` | 126.7 KB | 2000 | **157 ms** | 116 ms | 180 ms | 290 ms | 10 ms | 288 MB | 11 |
| `large` | 1.3 MB | 20000 | **176 ms** | 135 ms | 199 ms | 312 ms | 4 ms | 299 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **259 ms** | 219 ms | 283 ms | 377 ms | 9 ms | 352 MB | 5 |
| `log500m` | 497 MB | 5295839 | **168 ms** | 127 ms | 191 ms | — (plaintext) | 5 ms | 308 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 7 ms | 6 ms | 7 ms | 7 ms | 6 ms |
| node ready (bootstrapComplete) | 68 ms | 70 ms | 73 ms | 77 ms | 65 ms |
| bundle executed (main:start) | 68 ms | 70 ms | 73 ms | 77 ms | 65 ms |
| config loaded | 86 ms | 88 ms | 93 ms | 96 ms | 81 ms |
| keybindings loaded | 86 ms | 89 ms | 93 ms | 96 ms | 81 ms |
| session state loaded | 86 ms | 89 ms | 93 ms | 97 ms | 82 ms |
| extensions scanned | 82 ms | 84 ms | 86 ms | 92 ms | 77 ms |
| themes ready | 93 ms | 94 ms | 96 ms | 102 ms | 88 ms |
| DI container created | 97 ms | 98 ms | 100 ms | 106 ms | 92 ms |
| workbench mounted | 142 ms | 138 ms | 143 ms | 157 ms | 136 ms |
| first frame | 142 ms | 138 ms | 143 ms | 157 ms | 136 ms |
| workbench activated | 149 ms | 148 ms | 151 ms | 164 ms | 143 ms |
| grammars preloaded | 155 ms | 153 ms | 158 ms | 169 ms | 146 ms |
| file read from disk | 157 ms | 157 ms | 171 ms | 256 ms | 158 ms |
| file decoded | 157 ms | 157 ms | 171 ms | 256 ms | 158 ms |
| document built | 158 ms | 157 ms | 171 ms | 257 ms | 158 ms |
| tokenizer attached to editor | 179 ms | 180 ms | 198 ms | 284 ms | — |
| tabs opened | 162 ms | 164 ms | 181 ms | 266 ms | 178 ms |
| built-in extensions registered | 315 ms | 319 ms | 340 ms | 402 ms | 236 ms |
| frame with file text | 178 ms | 178 ms | 196 ms | 282 ms | 191 ms |
| frame with highlighting | 288 ms | 289 ms | 312 ms | 377 ms | — |
| extension host up | 560 ms | 604 ms | 683 ms | 1117 ms | 439 ms |
| startup complete | 307 ms | 310 ms | 330 ms | 394 ms | 225 ms |
| to text (black box) | 179 ms | 180 ms | 199 ms | 283 ms | 191 ms |
| to highlight (black box) | 288 ms | 290 ms | 312 ms | 377 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 1 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 30 ms | 13 ms | 10 ms | 11 ms | — | 9 ms | 3 ms |
| `medium` failed | 31 ms | 13 ms | 14 ms | 11 ms | — | 7 ms | 8 ms |
| `large` failed | 31 ms | 20 ms | 18 ms | 17 ms | — | 15 ms | 18 ms |
| `xlarge` failed | 30 ms | 41 ms | 26 ms | 40 ms | — | 15 ms | 90 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
