# File open benchmark

- Recorded: 2026-11-03T00:39:37.491Z, commit `d77616fe7f73`, diode nightly-d77616f
- Machine: AMD EPYC 9V45 96-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 16 ms; binary floor (`diode --version` over PTY, median): 44 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **95 ms** | 67 ms | 111 ms | 185 ms | 6 ms | 262 MB | 11 |
| `medium` | 126.7 KB | 2000 | **96 ms** | 68 ms | 112 ms | 184 ms | 5 ms | 282 MB | 11 |
| `large` | 1.3 MB | 20000 | **107 ms** | 79 ms | 124 ms | 198 ms | 5 ms | 299 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **171 ms** | 143 ms | 187 ms | 243 ms | 5 ms | 353 MB | 5 |
| `log500m` | 497 MB | 5295839 | **105 ms** | 77 ms | 121 ms | — (plaintext) | 7 ms | 272 MB | 3 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` | `log500m` |
| --- | ---: | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 5 ms | 6 ms | 8 ms | 5 ms |
| node ready (bootstrapComplete) | 47 ms | 48 ms | 53 ms | 66 ms | 44 ms |
| bundle executed (main:start) | 47 ms | 48 ms | 53 ms | 66 ms | 44 ms |
| config loaded | 61 ms | 59 ms | 63 ms | 83 ms | 58 ms |
| keybindings loaded | 62 ms | 61 ms | 63 ms | 84 ms | 59 ms |
| session state loaded | 62 ms | 61 ms | 64 ms | 84 ms | 59 ms |
| extensions scanned | 57 ms | 57 ms | 62 ms | 81 ms | 56 ms |
| themes ready | 64 ms | 64 ms | 66 ms | 88 ms | 62 ms |
| DI container created | 66 ms | 67 ms | 69 ms | 91 ms | 64 ms |
| workbench mounted | 86 ms | 84 ms | 89 ms | 111 ms | 85 ms |
| first frame | 86 ms | 84 ms | 89 ms | 111 ms | 85 ms |
| workbench activated | 90 ms | 87 ms | 92 ms | 114 ms | 88 ms |
| grammars preloaded | 94 ms | 94 ms | 99 ms | 119 ms | 93 ms |
| file read from disk | 96 ms | 97 ms | 108 ms | 166 ms | 100 ms |
| file decoded | 96 ms | 97 ms | 108 ms | 166 ms | 100 ms |
| document built | 96 ms | 97 ms | 108 ms | 166 ms | 100 ms |
| tokenizer attached to editor | 111 ms | 113 ms | 126 ms | 185 ms | — |
| tabs opened | 100 ms | 101 ms | 114 ms | 173 ms | 112 ms |
| built-in extensions registered | 201 ms | 201 ms | 214 ms | 259 ms | 148 ms |
| frame with file text | 111 ms | 110 ms | 122 ms | 183 ms | 121 ms |
| frame with highlighting | 185 ms | 184 ms | 198 ms | 243 ms | — |
| extension host up | 358 ms | 378 ms | 430 ms | 755 ms | 275 ms |
| startup complete | 197 ms | 197 ms | 211 ms | 255 ms | 143 ms |
| to text (black box) | 111 ms | 112 ms | 124 ms | 187 ms | 121 ms |
| to highlight (black box) | 185 ms | 184 ms | 198 ms | 243 ms | — |
| gap black − white (text) | 2 ms | 2 ms | 1 ms | 3 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` failed | 10 ms | 6 ms | 6 ms | 5 ms | — | 3 ms | 2 ms |
| `medium` failed | 18 ms | 10 ms | 6 ms | 6 ms | — | 4 ms | 3 ms |
| `large` failed | 30 ms | 16 ms | 13 ms | 18 ms | — | 13 ms | 14 ms |
| `xlarge` failed | 27 ms | 24 ms | 19 ms | 15 ms | — | 17 ms | 46 ms |
| `log500m` | — | — | — | — | — | — | — |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
