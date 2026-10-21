# File open benchmark

- Recorded: 2026-10-21T21:18:32.237Z, commit `a420fcf5bd06`, diode nightly-a420fcf
- Machine: AMD EPYC 9V45 96-Core Processor (4 cores, 16 GB), linux 7.0.0-1017-azure
- Conditions: CI, shared runner (GitHub Actions)
- node floor (`node -e ""` over PTY, median): 131 ms; binary floor (`diode --version` over PTY, median): 286 ms; for reference `node --version`: 24 ms (answers before V8 starts)

## Over the floor

The headline number is **our ms**: time to text minus the node floor (what everything of ours costs on top of the runtime). "Over binary floor" also subtracts SEA bundle parsing (`diode --version`), leaving the workbench startup itself. Medians across runs; IQR is the interquartile range, a row with IQR > 20 % of the median is marked "noisy".

| file | size | lines | our ms | over binary floor | to text | to highlight | IQR (to text) | peak RSS | runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 6.0 KB | 100 | **637 ms** | 483 ms | 769 ms | 1398 ms | 60 ms | 242 MB | 11 |
| `medium` | 126.7 KB | 2000 | **700 ms** | 545 ms | 831 ms | 1395 ms | 22 ms | 264 MB | 11 |
| `large` | 1.3 MB | 20000 | **1416 ms** | 1262 ms | 1548 ms | 2058 ms | 11 ms | 297 MB | 7 |
| `xlarge` | 13.1 MB | 200000 | **7465 ms** | 7310 ms | 7596 ms | 8395 ms | 226 ms | 484 MB | 5 |

## Mark ladder (white box)

`performance.mark` marks inside the process (`DIODE_STARTUP_TRACE`), median ms from spawn. The last rows are the black box (same run, from PTY bytes) and the gap "to text − frame with text": the cost of delivering the frame over PTY and through the bench parser.

| mark | `small` | `medium` | `large` | `xlarge` |
| --- | ---: | ---: | ---: | ---: |
| process start (timeOrigin) | 40 ms | 36 ms | 50 ms | 37 ms |
| node ready (bootstrapComplete) | 333 ms | 300 ms | 332 ms | 427 ms |
| bundle executed (main:start) | 333 ms | 300 ms | 333 ms | 427 ms |
| config loaded | 403 ms | 385 ms | 400 ms | 543 ms |
| keybindings loaded | 405 ms | 387 ms | 411 ms | 558 ms |
| session state loaded | 406 ms | 388 ms | 411 ms | 559 ms |
| extensions scanned | 384 ms | 353 ms | 382 ms | 511 ms |
| themes ready | 425 ms | 402 ms | 424 ms | 579 ms |
| DI container created | 449 ms | 418 ms | 439 ms | 602 ms |
| workbench mounted | 580 ms | 534 ms | 562 ms | 773 ms |
| first frame | 580 ms | 534 ms | 562 ms | 773 ms |
| workbench activated | 601 ms | 554 ms | 580 ms | 805 ms |
| grammars preloaded | 630 ms | 581 ms | 605 ms | 830 ms |
| file read from disk | 637 ms | 591 ms | 663 ms | 1191 ms |
| file decoded | 637 ms | 592 ms | 663 ms | 1191 ms |
| document built | 639 ms | 592 ms | 664 ms | 1192 ms |
| tokenizer attached to editor | 770 ms | 831 ms | 1550 ms | 7598 ms |
| tabs opened | 665 ms | 635 ms | 748 ms | 1380 ms |
| built-in extensions registered | 1514 ms | 1479 ms | 2143 ms | 8474 ms |
| frame with file text | 765 ms | 829 ms | 1547 ms | 7596 ms |
| frame with highlighting | 1396 ms | 1394 ms | 2058 ms | 8393 ms |
| extension host up | 2610 ms | 2495 ms | 3235 ms | 10330 ms |
| startup complete | 1482 ms | 1457 ms | 2125 ms | 8457 ms |
| to text (black box) | 769 ms | 831 ms | 1548 ms | 7596 ms |
| to highlight (black box) | 1398 ms | 1395 ms | 2058 ms | 8395 ms |
| gap black − white (text) | 1 ms | 2 ms | 0 ms | 0 ms |

## Workload after open

Keystroke latency: from the write to the PTY to the frame where the change is visible (median ms). The cursor is mid-file; search types one word as a single paste event.

| file | insert char | Enter | undo (Enter) | undo (char) | save | Ctrl+End | word search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 117 ms | 37 ms | 33 ms | 29 ms | 42 ms | 20 ms | 20 ms |
| `medium` | 109 ms | 45 ms | 39 ms | 35 ms | 39 ms | 15 ms | 31 ms |
| `large` | 229 ms | 217 ms | 251 ms | 264 ms | 212 ms | 40 ms | 58 ms |
| `xlarge` | 1136 ms | 2102 ms | 1926 ms | 1546 ms | 899 ms | 53 ms | 323 ms |

Methodology: the SEA binary runs in a PTY (120×32) in a hermetic environment (its own user-data-dir and HOME); time is counted from process spawn; the moment text/highlighting appears is recovered from stdout chunk timestamps. The node and binary floors are taken in the same run the same way (spawn over PTY, until the first output chunk): the node floor is `node -e ""`, the minimal process with a full V8 bootstrap (`node --version` answers before V8 starts and cannot be the runtime floor); the binary floor is `diode --version`, i.e. plus SEA bundle parsing. "To highlight" is the first frame where a keyword is colored by the theme. Peak RSS is the editor process `VmHWM` over the whole run (startup + workload). LSP is not measured. The first run of each size is a warm-up and is excluded from the stats.
