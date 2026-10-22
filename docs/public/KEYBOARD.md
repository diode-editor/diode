# Keyboard

Diode uses the VS Code keybindings, and `keybindings.json` works as in
[VS Code](https://code.visualstudio.com/docs/configure/keybindings). The difference is the
terminal in between: a terminal sends bytes, not key events, and some combinations don't survive
the trip. This page is about those, and about what to press instead.

## What a terminal can't send

A classic terminal encodes `Ctrl+Shift+P` exactly like `Ctrl+P`, turns `Ctrl+Tab` into `Tab`,
`Ctrl+Enter` into `Enter` and `Ctrl+Backspace` into `Ctrl+H`, and has no code for ``Ctrl+` `` at all.
Modern terminals fix this with an extended keyboard protocol (the kitty keyboard protocol, or
CSI u). Diode asks for it at startup; a terminal that supports it starts sending full key events,
and then every VS Code shortcut works as is.

Diode knows three levels of key support:

| level | what arrives | typical terminal |
| --- | --- | --- |
| legacy | Ctrl+letter, Alt, function keys | Terminal.app, GNOME Terminal, tmux by default |
| extended | plus Ctrl+Shift+letter, Ctrl+Tab, Ctrl+Enter, Shift+Enter, ``Ctrl+` `` | kitty, ghostty, WezTerm, foot, Alacritty, iTerm2, tmux 3.5+ with extended keys |
| cmd (Mac) | plus Cmd as in VS Code for macOS | kitty, ghostty, iTerm2 without tmux |

The left segment of the status bar shows the level Diode detected. Click it, or run **Diode:
Keyboard Doctor** from the command palette, to see what your terminal actually sends for each key:
the report opens as a document and lands in the clipboard. Getting to "extended" is a terminal
setting, see [terminal setup](TERMINAL.md).

## Every command has a key that works everywhere

Diode never leaves a command reachable only through a key the terminal can't send, and a test in
the build enforces it. The Ctrl+Shift shortcuts have a `Ctrl+K <letter>` chord next to them, and
the chord works at every level:

| command | VS Code key | works everywhere |
| --- | --- | --- |
| Command palette | `Ctrl+Shift+P` | `F1` |
| Explorer | `Ctrl+Shift+E` | `Ctrl+K E` |
| Search in files | `Ctrl+Shift+F` | `Ctrl+K F` |
| Source control | `Ctrl+Shift+G` | `Ctrl+K G` |
| Problems | `Ctrl+Shift+M` | `Ctrl+K M` |
| Extensions | `Ctrl+Shift+X` | `Ctrl+K X` |
| Terminal | ``Ctrl+` `` | `Ctrl+K T` |
| New terminal | ``Ctrl+Shift+` `` | `Ctrl+K Alt+T` |
| Save As | `Ctrl+Shift+S` | `Ctrl+K Alt+S` |
| Format document | `Shift+Alt+F` | `Ctrl+K Ctrl+E` |
| Organize imports | `Shift+Alt+O` | `Ctrl+K Alt+O` |
| Quick fix | `Ctrl+.` | `Ctrl+K Ctrl+Q` |
| Refactor | `Ctrl+Shift+R` | `Ctrl+K Alt+R` |
| Delete line | `Ctrl+Shift+K` | `Ctrl+K Ctrl+K` |
| Select all occurrences | `Ctrl+Shift+L` | `Ctrl+K Ctrl+A` |
| Fold / unfold | `Ctrl+Shift+[` / `Ctrl+Shift+]` | `Ctrl+K Alt+F` / `Ctrl+K Alt+U` |
| Go back / forward | `Ctrl+Alt+-` / `Ctrl+Shift+-` | `Ctrl+K Ctrl+B` / `Ctrl+K Ctrl+F` |
| Open to the side | `Ctrl+Enter` | `Alt+Enter` |
| Delete word left | `Ctrl+Backspace` | `Alt+Backspace` |
| Focus editor group 1, 2, 3 | `Ctrl+1`, `Ctrl+2`, `Ctrl+3` | `Ctrl+K 1`, `Ctrl+K 2`, `Ctrl+K 3` |
| Most recent tab | `Ctrl+Tab` | `Ctrl+PageDown` / `Ctrl+PageUp` (visual order), `Ctrl+6` (previous) |

The chord is what menus and the command palette show next to a command, so you don't have to
remember this table. On GNOME Terminal `Ctrl+PageUp`/`Ctrl+PageDown` switch the terminal's own
tabs; `Alt+PageUp` and `Alt+PageDown` do the same inside Diode. Word movement has `Alt+Left` /
`Alt+Right` next to `Ctrl+Left` / `Ctrl+Right`.

## On a Mac

Inside tmux and in Terminal.app, Cmd never reaches an app: Diode uses its Ctrl layout there, so
`Ctrl+P`, `Ctrl+S`, `Ctrl+Q` and the rest work as on Linux. In kitty, ghostty or iTerm2 without
tmux, Diode gets the Cmd keys and uses the VS Code for macOS layout (`Cmd+P`, `Cmd+S`, `Cmd+Q`,
`Cmd+Shift+]` for the next tab). Either way the Ctrl chords above keep working, and `Cmd+C`,
`Cmd+V`, `Cmd+X` are left to the terminal.

Diode decides whether the keyboard is a Mac's from the terminal it talks to, not from the machine
it runs on. Over ssh to a Linux box the terminal's name usually gives it away (iTerm2 and
Terminal.app announce themselves). When it doesn't, set `LC_DIODE_PLATFORM=mac` on the client:
ssh forwards `LC_*` variables by default. The `keyboard.platform` setting overrides both.

## Keys your terminal takes for itself

Some combinations never reach any application because the terminal or the window manager
handles them first: tab switching in the terminal, `Ctrl+Shift+C`/`Ctrl+Shift+V` as the
terminal's copy and paste, `Ctrl+Left`/`Ctrl+Right` for Mission Control on a Mac, `Cmd+W`/`Cmd+Q`
closing the terminal window. When a key does nothing in Diode, run **Diode: Keyboard Doctor**
first: if the key doesn't show up there, it was taken before Diode saw it, and the fix is in the
terminal's settings.
