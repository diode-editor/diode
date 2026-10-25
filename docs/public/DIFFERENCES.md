# Differences from VS Code

Diode aims to be VS Code in a terminal: the same layout, commands, keys, `settings.json` and
extensions. Where it differs, it is either something a terminal can't do or a deliberate choice.
This page collects both in one place; what is missing altogether is on [Status](STATUS.md).

## What a terminal changes

- **Some keys don't arrive.** A classic terminal can't deliver `Ctrl+Shift+<letter>`, `Ctrl+Tab`
  or ``Ctrl+` ``; every such command has a `Ctrl+K` chord that works anywhere, and modern
  terminals deliver the originals ([keyboard](KEYBOARD.md)).
- **Cmd on a Mac** reaches Diode only in terminals that forward it (kitty, ghostty, iTerm2) and
  never inside tmux; elsewhere Diode uses its Ctrl layout ([on a Mac](KEYBOARD.md#on-a-mac)).
- **Copy and paste** go through the terminal: copy is sent with OSC 52 and reaches your local
  clipboard even over ssh; text from outside comes in through the terminal's own paste gesture.
  Selecting text with the terminal's own selection needs its usual override, `Shift`+drag in most
  terminals ([clipboard](TERMINAL.md#clipboard)).
- **Colors are 24-bit only**, as the theme defines them; there is no 256-color fallback
  ([colors](TERMINAL.md#colors)).
- **No webviews.** Anything in an extension that needs a browser is a no-op: the rest of the
  extension keeps working ([what can't work](EXTENSIONS.md#what-cant-work)).
- **File links in the integrated terminal** open with `Ctrl`+click on every platform: a terminal
  doesn't report Cmd with the mouse. There is no "Follow link" hover, and only paths that exist are
  links: URLs, and words looked up with Quick Open, are not yet. **Terminal: Open Detected Link...**
  (`Ctrl+Shift+O`) lists the files and folders only, and doesn't preview the file in an editor; in a
  terminal that can't tell `Ctrl+Shift+O` from `Ctrl+O` it runs from the Command Palette.
- **No tooltips, no drag and drop.** Hover information is a widget under the caret, a status bar
  item's tooltip is not shown, and tabs and tree items are not draggable.

## Deliberate choices

- **No activity bar.** Click the sidebar title (`EXPLORER ⌄`) or press Enter on it to switch
  between Explorer, Search, Source Control, Extensions and the views extensions add. Each view
  also has a key ([first run](FIRST-RUN.md#find-your-way-around)).
- **`.diode/` instead of `.vscode/`.** Workspace settings and tasks live in
  `<folder>/.diode/settings.json` and `<folder>/.diode/tasks.json`; Diode doesn't read the `.vscode`
  folder, so a project can carry both. User data lives under `~/.diode`
  ([where things live](FIRST-RUN.md#where-things-live)).
- **No settings UI.** `Ctrl+,` opens `settings.json` with completion for every key; the
  [settings catalog](https://diode-editor.github.io/docs/reference/settings/) lists them. A VS Code
  setting missing from the catalog has no effect.
- **A curated extension store**, not a mirror of the VS Code Marketplace or Open VSX: every
  extension in it has been checked to work in a terminal. Any `.vsix` still installs
  ([extensions](EXTENSIONS.md)).
- **Extensions load at startup.** After an install, update or uninstall, run **Reload Window**;
  there is no hot reload, and extensions don't update themselves.
- **Notifications are toasts without a notification center.** A message that went away can't be
  brought back yet.
- **Window title** is `<folder> - <profile> - Diode`, like VS Code's, and inside tmux it is the
  pane title ([window title](TERMINAL.md#window-title)).
