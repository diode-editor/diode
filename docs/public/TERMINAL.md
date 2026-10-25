# Terminal setup

Diode works in any terminal that speaks ANSI, with no configuration. What a modern terminal adds
on top: 24-bit color, extended keys for the Ctrl+Shift shortcuts, and clipboard over ssh. This
page says what to expect from each, what to switch on, and how to run Diode inside tmux.

## Colors

Diode always draws in 24-bit color, the way the theme defines it: there is no 256-color fallback.
Every terminal in use today supports it (kitty, ghostty, WezTerm, Alacritty, foot, iTerm2,
Terminal.app, GNOME Terminal, Konsole, Windows Terminal). Inside tmux and over ssh, the color
depth is the outer terminal's, so nothing changes.

The integrated terminal's 16 colors come from the theme. Set `terminal.integrated.colorSource` to
`host` to use your terminal's own palette instead; Diode reads it at startup.

### Light and dark

Set `window.autoDetectColorScheme` to `true`, and Diode picks the color theme from your terminal's
scheme: `workbench.preferredDarkColorTheme` on a dark one, `workbench.preferredLightColorTheme` on
a light one. While it's on, the theme you choose in **Preferences: Color Theme** becomes the theme
for the current scheme.

- Ghostty, kitty, Contour and tmux 3.6+ report every switch, so when your OS changes between
  light and dark and the terminal's theme follows it, Diode switches too, right away.
- Other terminals: Diode looks at the terminal's background color once, at startup.

Diode follows your terminal, not the OS. If your terminal keeps one theme whatever the OS does,
Diode keeps one too.

## Icons

Diode draws icons with [Nerd Font](https://www.nerdfonts.com/) glyphs: file icons in the Explorer
and on tabs, chevrons, toolbar buttons, Problems severities, the branch in the status bar.
WezTerm, kitty and Ghostty carry these glyphs themselves, whatever your font. In other terminals,
install a Nerd Font and pick it in the terminal settings.

Without one, the icons come out as empty boxes or question marks. Then set
`"diode.icons.nerdFont": "off"`: icons become plain Unicode characters that every monospace font
has, and file icons are hidden. The default, `auto`, turns the glyphs off only on the Linux console
(`TERM=linux`), whose font is known to lack them: the font of any other terminal can't be detected.
The setting applies at once, no restart needed.

## Keys

The Ctrl+Shift shortcuts, `Ctrl+Tab`, `Ctrl+Enter` and ``Ctrl+` `` need an extended keyboard
protocol. Diode asks for both the kitty keyboard protocol and xterm's `modifyOtherKeys` at startup
and uses whichever the terminal answers with; see [Keyboard](KEYBOARD.md) for what works without
it. Terminal by terminal:

- **kitty**, **ghostty**, **foot**, **Alacritty**: nothing to configure. In kitty, `Ctrl+Shift+<key>`
  is also kitty's own shortcut prefix; the shortcuts you use in Diode may need to be unmapped in
  `kitty.conf`. In ghostty, unbind `Alt+Left`/`Alt+Right` if you want them in Diode, otherwise
  ghostty sends the legacy word-movement sequences.
- **WezTerm**: `enable_kitty_keyboard = true` in `wezterm.lua`.
- **iTerm2**: Settings → Profiles → Keys → General, turn on "Apps can change how keys are
  reported", and set the Left Command key to act as Super so Diode gets the Cmd shortcuts.
- **Terminal.app**, **GNOME Terminal**, **Konsole**: no extended keys; the `Ctrl+K` chords stand
  in for the Ctrl+Shift shortcuts, `F1` for the palette.
- **On a Mac**, make the left Option key act as Alt and keep the right one for symbols: kitty
  `macos_option_as_alt left`, ghostty `macos-option-as-alt = left`, WezTerm
  `send_composed_key_when_left_alt_is_pressed = false`, iTerm2 "Left Option key: Esc+",
  Terminal.app "Use Option as Meta key". Cmd shortcuts the terminal keeps for itself (`Cmd+T`,
  `Cmd+N`, `Cmd+P`, ...) need unmapping in the terminal to reach Diode.

**Diode: Keyboard Doctor** (command palette, or click the left status bar segment) walks through
the keys, shows what arrived, and ends with the recipe for your terminal.

If detection gets it wrong, `terminal.tier` forces a level (`auto`, `legacy`, `csi-u`, `kitty`),
and `terminal.capabilities` forces single capabilities on or off.

## Clipboard

Copy and cut (`Ctrl+C`, `Ctrl+X`) send the text to the terminal with OSC 52, which every modern
terminal turns into a system clipboard write. It travels over the tty, so it works over ssh and in
containers without any clipboard tool on the remote side. Some terminals ask before accepting the
first OSC 52 write, or have it disabled by default: check the terminal's settings if a copy
doesn't show up.

`Ctrl+V` pastes what Diode copied last. Text from outside comes through the terminal's own paste
gesture (`Ctrl+Shift+V`, `Cmd+V`, middle click): Diode receives it as one block with bracketed
paste, so newlines and tabs land as text and never trigger shortcuts.

The mouse is always on in Diode, so the terminal's own text selection needs its usual override:
`Shift`+drag in most terminals, `Option`+drag in iTerm2.

## Over ssh

Nothing to set up: Diode is one binary on the remote side, keys and colors are those of your
local terminal, copy reaches your local clipboard through OSC 52. If Diode doesn't recognize a
Mac keyboard over ssh, set `LC_DIODE_PLATFORM=mac` locally; ssh forwards `LC_*` by default
([Keyboard](KEYBOARD.md#on-a-mac)).

## tmux

Diode runs inside tmux as is. Two things need lines in `~/.tmux.conf`: extended keys and the
window title.

### Keys

By default tmux strips the modifiers that only an extended protocol can carry: inside tmux,
`Ctrl+Tab` arrives as a plain `Tab` and `Ctrl+Shift+letter` doesn't arrive at all. tmux 3.5 or
newer can pass them through:

```tmux
set -s extended-keys always
set -s extended-keys-format csi-u   # tmux 3.5+ only
set -as terminal-features ',*:extkeys'
```

tmux 3.4 has no `extended-keys-format`, and with kitty as the outer terminal it can't deliver these
keys at all. Every command still has a key that works in any tmux: switch tabs with
`Ctrl+PageDown`/`Ctrl+PageUp`, and the `Ctrl+K <key>` chords stand in for the Ctrl+Shift
shortcuts.

On a Mac, Cmd never reaches an app inside tmux: tmux stores Cmd and Option in the same bit, so Diode
uses its Ctrl layout there. If you set `LC_DIODE_PLATFORM=mac`, let tmux pass it on:

```tmux
set -ag update-environment LC_DIODE_PLATFORM
```

### Clipboard

tmux blocks OSC 52 unless told otherwise:

```tmux
set -s set-clipboard on
set -g allow-passthrough on
```

### Window title

Diode sets the terminal title to `<folder> - <profile> - Diode` (the profile is omitted for
Default), the same shape VS Code uses for its window title, and restores the previous title on
exit. Inside tmux this is the **pane title**; choose where it should show up:

```tmux
# The terminal window (or tab) running tmux shows the active pane's title
set -g set-titles on
set -g set-titles-string '#T'

# tmux windows are named after their pane's title, but only for Diode;
# other windows keep the default naming (the running command)
setw -g automatic-rename on
setw -g automatic-rename-format '#{?#{==:#{pane_current_command},diode},#{pane_title},#{pane_current_command}}'
```

`allow-set-title` must stay at its default `on`. Renaming a window by hand (`prefix ,`) turns
`automatic-rename` off for that window. Apply with `tmux source-file ~/.tmux.conf`; to check, run
`tmux display -p -t <pane> '#{pane_title} | #{window_name}'` from another pane while Diode is
running.

## GNU Screen

Works as a legacy terminal. Screen doesn't answer color queries, so `terminal.integrated.colorSource: host`
falls back to the theme's palette.
