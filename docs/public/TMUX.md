# Diode in tmux

Diode runs inside tmux as is. This page covers what tmux needs from your config: extended keys
(Ctrl+Tab, Ctrl+Shift+letter) and showing Diode's window title.

## Keys: Ctrl+Tab and Ctrl+Shift+letter

By default tmux strips the modifiers that a terminal can only send with an extended keyboard
protocol: inside tmux, Ctrl+Tab arrives as a plain Tab and Ctrl+Shift+letter doesn't arrive at all.
tmux 3.5 or newer can pass them through. Add to `~/.tmux.conf`:

```tmux
set -s extended-keys always
set -g extended-keys-format csi-u   # tmux 3.5+ only
set -as terminal-features ',*:extkeys'
```

tmux 3.4 has no `extended-keys-format`, and with kitty as the outer terminal it can't deliver these
keys at all. Every command still has a key that works in any tmux: switch tabs with
`Ctrl+PageDown`/`Ctrl+PageUp`, and the `Ctrl+K <key>` chords (`Ctrl+K F` for Search, `Ctrl+K G` for
Source Control) stand in for the Ctrl+Shift shortcuts. **Diode: Keyboard Doctor** shows what your
terminal actually sends.

On a Mac, Cmd never reaches an app inside tmux: tmux stores Cmd and Option in the same bit. Diode
uses its Ctrl-based layout there. If you set `LC_DIODE_PLATFORM=mac` to tell Diode the keyboard is a
Mac's, let tmux pass it on:

```tmux
set -ag update-environment LC_DIODE_PLATFORM
```

## Window title

Diode sets the terminal title to `<folder> - <profile> - Diode` (the profile is omitted for
Default), the same shape VS Code uses for its window title. It sends a plain `OSC 0` sequence, the
way shells and vim do. Inside tmux this sets the **pane title** (`#{pane_title}`, `#T`). When Diode
exits, it restores the previous title: it saves the title with `CSI 22;0t` at startup and restores it
with `CSI 23;0t` on exit, so your shell's title comes back.

By default tmux keeps the pane title to itself. Choose where it should show up and add the matching
lines to `~/.tmux.conf`.

### Outer terminal window title

```tmux
# The terminal window (or tab) running tmux shows the active pane's title
set -g set-titles on
set -g set-titles-string '#T'
```

### tmux window name (status bar)

```tmux
# Windows are named after their pane's title...
setw -g automatic-rename on
setw -g automatic-rename-format '#{pane_title}'
```

With this format every window is named after its pane title. A shell that never sets a title leaves
it at the host name. To rename only Diode's windows and keep the default naming (the running
command) for the rest:

```tmux
setw -g automatic-rename on
setw -g automatic-rename-format '#{?#{==:#{pane_current_command},diode},#{pane_title},#{pane_current_command}}'
```

`pane_current_command` is `diode` for the installed binary. If you run Diode from sources, it is
`node`.

Renaming a window by hand (`prefix ,`) turns `automatic-rename` off for that window.

### Applying the config

```sh
tmux source-file ~/.tmux.conf
```

### What you don't need

- `allow-passthrough`: Diode doesn't wrap the title in tmux passthrough, so tmux reads it directly.
  The option only matters for sequences tmux forwards to the outer terminal, such as the OSC 52
  clipboard.
- `allow-rename`: that option covers the `ESC k … ESC \` window-name sequence, which Diode doesn't
  send. The window name comes from the pane title through `automatic-rename-format` (see above).
- `allow-set-title` must stay at its default `on`. If it is `off`, tmux ignores title changes from
  the pane.

### Checking

Start Diode in a tmux pane and run this from another pane:

```sh
tmux display -p -t <pane> '#{pane_title} | #{window_name}'
```

While Diode is running, both fields read `<folder> - <profile> - Diode`. After you quit, the pane
title is back to what it was before.
