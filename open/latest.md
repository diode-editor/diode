# File open benchmark

- Recorded: 2026-11-10T05:21:01.051Z, commit `8d7a372ac449`, diode nightly-8d7a372
- Machine: AMD EPYC 9V45 96-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 17 ms; binary floor (`diode --version` over PTY, median): 45 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **101 ms** | 73 ms | 118 ms | 191 ms | 8 ms | 267 MB | 11 |
| `medium` | 126.7 KB | 2000 | **103 ms** | 76 ms | 121 ms | 193 ms | 4 ms | 288 MB | 11 |
| `large` | 1.3 MB | 20000 | **121 ms** | 94 ms | 139 ms | 215 ms | 15 ms | 304 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **176 ms** | 148 ms | 194 ms | 254 ms | 7 ms | 360 MB | 5 |
| `log500m` | 497 MB | 5295839 | **117 ms** | 89 ms | 134 ms | — (plaintext) | 5 ms | 278 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 6 ms | 5 ms | 6 ms | 9 ms | 5 ms |
| node ready (bootstrapComplete) | 50 ms | 50 ms | 56 ms | 64 ms | 48 ms |
| bundle executed (main:start) | 50 ms | 50 ms | 56 ms | 64 ms | 48 ms |
| config loaded | 63 ms | 62 ms | 72 ms | 86 ms | 61 ms |
| keybindings loaded | 63 ms | 65 ms | 73 ms | 86 ms | 63 ms |
| session state loaded | 63 ms | 65 ms | 73 ms | 86 ms | 63 ms |
| extensions scanned | 61 ms | 60 ms | 67 ms | 80 ms | 58 ms |
| themes ready | 66 ms | 67 ms | 75 ms | 88 ms | 65 ms |
| DI container created | 67 ms | 69 ms | 77 ms | 90 ms | 68 ms |
| workbench mounted | 91 ms | 92 ms | 99 ms | 113 ms | 93 ms |
| first frame | 91 ms | 92 ms | 99 ms | 113 ms | 93 ms |
| workbench activated | 96 ms | 96 ms | 105 ms | 118 ms | 98 ms |
| grammars preloaded | 103 ms | 101 ms | 114 ms | 122 ms | 104 ms |
| file read from disk | 105 ms | 104 ms | 121 ms | 173 ms | 111 ms |
| file decoded | 105 ms | 104 ms | 121 ms | 173 ms | 111 ms |
| document built | 105 ms | 104 ms | 121 ms | 173 ms | 111 ms |
| tokenizer attached to editor | 118 ms | 121 ms | 139 ms | 193 ms | — |
| tabs opened | 107 ms | 108 ms | 127 ms | 180 ms | 123 ms |
| built-in extensions registered | 208 ms | 214 ms | 234 ms | 271 ms | 167 ms |
| frame with file text | 117 ms | 119 ms | 137 ms | 192 ms | 134 ms |
| frame with highlighting | 188 ms | 193 ms | 214 ms | 254 ms | — |
| extension host up | 359 ms | 389 ms | 450 ms | 770 ms | 299 ms |
| startup complete | 202 ms | 206 ms | 228 ms | 266 ms | 159 ms |
| to text (black box) | 118 ms | 121 ms | 139 ms | 194 ms | 134 ms |
| to highlight (black box) | 191 ms | 193 ms | 215 ms | 254 ms | — |
| gap black − white (text) | 1 ms | 2 ms | 1 ms | 2 ms | 1 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 10 ms | 6 ms | 6 ms | 5 ms | — | 3 ms | 2 ms |
| `medium` failed | 18 ms | 11 ms | 7 ms | 6 ms | — | 4 ms | 3 ms |
| `large` failed | 34 ms | 19 ms | 18 ms | 13 ms | — | 19 ms | 18 ms |
| `xlarge` failed | 21 ms | 22 ms | 16 ms | 40 ms | — | 17 ms | 40 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
