# First run

If you know VS Code, you know Diode: the same layout, the same commands, the same keys wherever
the terminal can deliver them. This page is the ten-minute tour: what to type, how to get around,
how to quit, and where your settings live.

## Open something

```sh
diode .                 # a folder
diode src/app.ts        # a file (the folder stays closed)
diode -g app.ts:42:7    # a file with the caret at line 42, column 7
diode -d old.ts new.ts  # a diff
diode                   # an empty window
```

The first argument becomes the folder if it is a directory, or the workspace if it is a
`.code-workspace` file; every other argument opens as a file. An empty window doesn't open the
current directory: pick a folder from inside with the **Open Folder** button in the Explorer or
**File: Open Folder...** in the command palette (`Ctrl+K Ctrl+O`).

`diode --help` lists the rest: `--profile`, `--user-data-dir`, `--log`, extension management
([extensions](EXTENSIONS.md)).

## Find your way around

Everything is a command, and the command palette is always one key away: **F1** works in every
terminal, `Ctrl+Shift+P` where the terminal can deliver it ([keyboard](KEYBOARD.md)). There is no
activity bar: click the sidebar title (`EXPLORER ⌄`, or Enter on it) to switch between Explorer, Search,
Source Control, Extensions and the containers your extensions add. Each view is also a command with a
`Ctrl+K` chord that works everywhere:

| | VS Code key | works in any terminal |
| --- | --- | --- |
| Command palette | `Ctrl+Shift+P` | `F1` |
| Go to file | `Ctrl+P` | `Ctrl+P` |
| Explorer | `Ctrl+Shift+E` | `Ctrl+K E` |
| Search in files | `Ctrl+Shift+F` | `Ctrl+K F` |
| Source control | `Ctrl+Shift+G` | `Ctrl+K G` |
| Problems | `Ctrl+Shift+M` | `Ctrl+K M` |
| Terminal | ``Ctrl+` `` | `Ctrl+K T` |
| Extensions | `Ctrl+Shift+X` | `Ctrl+K X` |
| Toggle sidebar | `Ctrl+B` | `Ctrl+B` |
| Toggle panel | `Ctrl+J` | `Ctrl+J` |
| Next / previous tab | `Ctrl+PageDown` / `Ctrl+PageUp` | same, or `Alt+PageDown` / `Alt+PageUp` |

The mouse works: click to place the caret, drag to select, scroll, click tabs and tree items.
There is a menu bar too, so a command you can't remember is a click away.

## Quit

`Ctrl+Q`, or **File → Exit**. Unsaved files get the usual **Save / Don't Save / Cancel** dialog;
Cancel keeps the editor open.

## Where things live

Diode keeps everything under `~/.diode` on every platform (`--user-data-dir` moves it):

| | path |
| --- | --- |
| user settings | `~/.diode/user-data/User/settings.json` |
| user keybindings | `~/.diode/user-data/User/keybindings.json` |
| named profiles | `~/.diode/user-data/User/profiles/<id>/` |
| extensions | `~/.diode/extensions/` |
| logs | `~/.diode/user-data/logs/` |
| workspace settings | `<folder>/.diode/settings.json` |

`Ctrl+,` opens the user `settings.json`: there is no settings UI, the file is the editor. The keys
and their defaults are the VS Code ones; the [settings catalog](https://diode-editor.github.io/docs/reference/settings/)
lists every key Diode understands, and the file gets completion for them. Keybindings follow
[VS Code's keybindings.json](https://code.visualstudio.com/docs/configure/keybindings) format;
`Ctrl+K Ctrl+S` opens the keyboard shortcuts editor.

Workspace settings live in `.diode/settings.json`, not `.vscode/`: Diode doesn't read the
`.vscode` folder, so a project can carry both without one editor touching the other's file.

## Profiles

As in VS Code, a profile is a set of settings, keybindings and extensions. **Profiles: New
Profile...**, **Profiles: Switch Profile...** and **Profiles: Delete Profile...** are in the command
palette; switching binds the open folder to the profile and reloads the window, so the folder comes
back with the same profile next time. `diode --profile <name> .` starts with a given profile.

## Next

- [Keyboard](KEYBOARD.md): which keys a terminal can't deliver and what to press instead.
- [Terminal setup](TERMINAL.md): colors, extended keys, clipboard over ssh, tmux.
- [Extensions](EXTENSIONS.md): languages and tools from the store.
