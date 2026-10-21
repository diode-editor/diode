# File open benchmark

- Recorded: 2026-10-21T18:28:38.489Z, commit `e8aa617a1b05`, diode nightly-e8aa617
- Machine: Intel(R) Xeon(R) 6973P-C (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 17 ms; binary floor (`diode --version` over PTY, median): 40 ms; for reference `node --version`: 3 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **96 ms** | 73 ms | 113 ms | 189 ms | 6 ms | 244 MB | 11 |
| `medium` | 126.7 KB | 2000 | **121 ms** | 97 ms | 137 ms | 219 ms | 6 ms | 248 MB | 11 |
| `large` | 1.3 MB | 20000 | **219 ms** | 195 ms | 235 ms | 310 ms | 11 ms | 302 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **1043 ms** | 1020 ms | 1060 ms | 1175 ms | 5 ms | 500 MB | 5 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` |
| --- | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 5 ms | 5 ms | 5 ms | 5 ms |
| node ready (bootstrapComplete) | 47 ms | 49 ms | 48 ms | 57 ms |
| bundle executed (main:start) | 47 ms | 49 ms | 48 ms | 57 ms |
| config loaded | 59 ms | 60 ms | 60 ms | 70 ms |
| keybindings loaded | 60 ms | 61 ms | 60 ms | 72 ms |
| session state loaded | 60 ms | 61 ms | 60 ms | 72 ms |
| extensions scanned | 57 ms | 58 ms | 58 ms | 68 ms |
| themes ready | 62 ms | 64 ms | 63 ms | 74 ms |
| DI container created | 65 ms | 67 ms | 66 ms | 77 ms |
| workbench mounted | 85 ms | 88 ms | 85 ms | 94 ms |
| first frame | 85 ms | 88 ms | 85 ms | 94 ms |
| workbench activated | 88 ms | 91 ms | 88 ms | 98 ms |
| grammars preloaded | 95 ms | 98 ms | 95 ms | 106 ms |
| file read from disk | 96 ms | 99 ms | 103 ms | 164 ms |
| file decoded | 96 ms | 99 ms | 103 ms | 164 ms |
| document built | 96 ms | 100 ms | 103 ms | 165 ms |
| tokenizer attached to editor | 112 ms | 136 ms | 237 ms | 1062 ms |
| tabs opened | 100 ms | 105 ms | 115 ms | 194 ms |
| built-in extensions registered | 201 ms | 231 ms | 322 ms | 1187 ms |
| frame with file text | 112 ms | 134 ms | 235 ms | 1060 ms |
| frame with highlighting | 189 ms | 219 ms | 310 ms | 1175 ms |
| extension host up | 347 ms | 386 ms | 500 ms | 1614 ms |
| startup complete | 198 ms | 227 ms | 319 ms | 1184 ms |
| to text (black box) | 113 ms | 137 ms | 235 ms | 1060 ms |
| to highlight (black box) | 189 ms | 219 ms | 310 ms | 1175 ms |
| gap black − white (text) | 1 ms | 3 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 30 ms | 10 ms | 7 ms | 5 ms | 9 ms | 4 ms | 2 ms |
| `medium` | 27 ms | 12 ms | 11 ms | 9 ms | 12 ms | 4 ms | 3 ms |
| `large` | 48 ms | 39 ms | 29 ms | 44 ms | 53 ms | 8 ms | 13 ms |
| `xlarge` | 166 ms | 186 ms | 243 ms | 208 ms | 242 ms | 12 ms | 47 ms |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
