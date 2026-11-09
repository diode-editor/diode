# File open benchmark

- Recorded: 2026-11-09T01:19:22.731Z, commit `0745ec47b126`, diode nightly-0745ec4
- Machine: AMD EPYC 9V45 96-Core Processor (4 cores, 16 GB), linux 7.0.0-1019-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 16 ms; binary floor (`diode --version` over PTY, median): 43 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **97 ms** | 70 ms | 113 ms | 178 ms | 5 ms | 272 MB | 11 |
| `medium` | 126.7 KB | 2000 | **99 ms** | 73 ms | 116 ms | 183 ms | 3 ms | 288 MB | 11 |
| `large` | 1.3 MB | 20000 | **105 ms** | 78 ms | 121 ms | 190 ms | 5 ms | 306 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **160 ms** | 133 ms | 176 ms | 233 ms | 5 ms | 360 MB | 5 |
| `log500m` | 497 MB | 5295839 | **104 ms** | 77 ms | 121 ms | — (plaintext) | 2 ms | 278 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 5 ms | 6 ms | 9 ms | 5 ms |
| node ready (bootstrapComplete) | 48 ms | 47 ms | 51 ms | 53 ms | 44 ms |
| bundle executed (main:start) | 48 ms | 47 ms | 51 ms | 53 ms | 44 ms |
| config loaded | 59 ms | 59 ms | 61 ms | 74 ms | 55 ms |
| keybindings loaded | 60 ms | 59 ms | 61 ms | 78 ms | 55 ms |
| session state loaded | 60 ms | 59 ms | 61 ms | 78 ms | 55 ms |
| extensions scanned | 58 ms | 57 ms | 58 ms | 68 ms | 53 ms |
| themes ready | 63 ms | 63 ms | 66 ms | 81 ms | 58 ms |
| DI container created | 65 ms | 65 ms | 68 ms | 83 ms | 60 ms |
| workbench mounted | 87 ms | 87 ms | 90 ms | 103 ms | 84 ms |
| first frame | 87 ms | 87 ms | 90 ms | 103 ms | 84 ms |
| workbench activated | 91 ms | 92 ms | 95 ms | 107 ms | 89 ms |
| grammars preloaded | 97 ms | 97 ms | 98 ms | 111 ms | 94 ms |
| file read from disk | 99 ms | 100 ms | 105 ms | 154 ms | 101 ms |
| file decoded | 99 ms | 100 ms | 105 ms | 154 ms | 101 ms |
| document built | 99 ms | 100 ms | 105 ms | 154 ms | 101 ms |
| tokenizer attached to editor | 111 ms | 115 ms | 123 ms | 176 ms | — |
| tabs opened | 102 ms | 104 ms | 110 ms | 161 ms | 112 ms |
| built-in extensions registered | 196 ms | 201 ms | 208 ms | 251 ms | 152 ms |
| frame with file text | 111 ms | 114 ms | 120 ms | 174 ms | 120 ms |
| frame with highlighting | 178 ms | 183 ms | 190 ms | 233 ms | — |
| extension host up | 341 ms | 365 ms | 402 ms | 726 ms | 273 ms |
| startup complete | 191 ms | 195 ms | 202 ms | 245 ms | 145 ms |
| to text (black box) | 113 ms | 116 ms | 121 ms | 176 ms | 121 ms |
| to highlight (black box) | 178 ms | 183 ms | 190 ms | 233 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 1 ms | 2 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 9 ms | 6 ms | 5 ms | 5 ms | — | 4 ms | 2 ms |
| `medium` failed | 17 ms | 8 ms | 5 ms | 4 ms | — | 3 ms | 3 ms |
| `large` failed | 23 ms | 11 ms | 14 ms | 10 ms | — | 19 ms | 16 ms |
| `xlarge` failed | 20 ms | 24 ms | 14 ms | 17 ms | — | 12 ms | 40 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
