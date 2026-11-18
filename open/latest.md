# File open benchmark

- Recorded: 2026-11-18T01:43:01.215Z, commit `420156ec0876`, diode nightly-420156e
- Machine: Intel(R) Xeon(R) 6975P-C (4 cores, 15 GB), linux 7.0.0-1016-aws
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 18 ms; binary floor (`diode --version` over PTY, median): 54 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **128 ms** | 93 ms | 146 ms | 229 ms | 4 ms | 275 MB | 11 |
| `medium` | 126.7 KB | 2000 | **125 ms** | 90 ms | 144 ms | 228 ms | 5 ms | 297 MB | 11 |
| `large` | 1.3 MB | 20000 | **140 ms** | 104 ms | 158 ms | 240 ms | 8 ms | 308 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **206 ms** | 171 ms | 225 ms | 298 ms | 10 ms | 360 MB | 5 |
| `log500m` | 497 MB | 5295839 | **133 ms** | 97 ms | 151 ms | — (plaintext) | 3 ms | 329 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 5 ms | 6 ms | 7 ms | 4 ms |
| node ready (bootstrapComplete) | 57 ms | 57 ms | 58 ms | 68 ms | 54 ms |
| bundle executed (main:start) | 57 ms | 57 ms | 58 ms | 68 ms | 54 ms |
| config loaded | 73 ms | 71 ms | 72 ms | 82 ms | 75 ms |
| keybindings loaded | 74 ms | 71 ms | 73 ms | 83 ms | 75 ms |
| session state loaded | 74 ms | 71 ms | 73 ms | 83 ms | 75 ms |
| extensions scanned | 70 ms | 66 ms | 68 ms | 79 ms | 69 ms |
| themes ready | 78 ms | 75 ms | 77 ms | 87 ms | 78 ms |
| DI container created | 81 ms | 78 ms | 80 ms | 90 ms | 80 ms |
| workbench mounted | 112 ms | 109 ms | 111 ms | 122 ms | 108 ms |
| first frame | 112 ms | 109 ms | 111 ms | 122 ms | 108 ms |
| workbench activated | 119 ms | 116 ms | 118 ms | 128 ms | 114 ms |
| grammars preloaded | 128 ms | 125 ms | 128 ms | 137 ms | 118 ms |
| file read from disk | 130 ms | 127 ms | 140 ms | 205 ms | 126 ms |
| file decoded | 130 ms | 127 ms | 140 ms | 205 ms | 126 ms |
| document built | 130 ms | 127 ms | 140 ms | 205 ms | 126 ms |
| tokenizer attached to editor | 145 ms | 143 ms | 158 ms | 226 ms | — |
| tabs opened | 134 ms | 131 ms | 146 ms | 213 ms | 138 ms |
| built-in extensions registered | 247 ms | 245 ms | 258 ms | 314 ms | 181 ms |
| frame with file text | 144 ms | 141 ms | 157 ms | 224 ms | 151 ms |
| frame with highlighting | 229 ms | 228 ms | 240 ms | 298 ms | — |
| extension host up | 420 ms | 444 ms | 524 ms | 882 ms | 326 ms |
| startup complete | 240 ms | 239 ms | 252 ms | 308 ms | 173 ms |
| to text (black box) | 146 ms | 144 ms | 158 ms | 225 ms | 151 ms |
| to highlight (black box) | 229 ms | 228 ms | 240 ms | 298 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 1 ms | 1 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 26 ms | 12 ms | 6 ms | 7 ms | — | 3 ms | 3 ms |
| `medium` failed | 25 ms | 10 ms | 8 ms | 10 ms | — | 4 ms | 5 ms |
| `large` failed | 32 ms | 24 ms | 19 ms | 16 ms | — | 13 ms | 17 ms |
| `xlarge` failed | 31 ms | 20 ms | 17 ms | 16 ms | — | 11 ms | 61 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
