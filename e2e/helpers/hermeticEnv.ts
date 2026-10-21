// Every spawn is pinned to one baseline (tier=legacy, mode=local, TERM=xterm-256color):
// the headless backend doesn't resolve the protocol probe, and inherited host markers (kitty in tmux →
// tier csi-u, legacy on CI) would change the active chords and the status bar in screenshots.

/** `terminalEnvironmentModel` uses these to detect extended-keys, truecolor and ssh/tmux. */
const TERMINAL_IDENTITY_VARS = [
    "KITTY_WINDOW_ID",
    "GHOSTTY_RESOURCES_DIR",
    "WEZTERM_PANE",
    "ALACRITTY_WINDOW_ID",
    "TERM_PROGRAM",
    "TERM_PROGRAM_VERSION",
    "COLORTERM",
    "TMUX",
    "TMUX_PANE",
    "SSH_TTY",
    "SSH_CONNECTION",
    "SSH_CLIENT",
    // Keyboard OS (Mac layout) — the scenario sets it explicitly via keyboard.platform.
    "LC_DIODE_PLATFORM",
    "LC_TERMINAL",
] as const;

/**
 * Identity is pinned LAST: some callers spread a whole `process.env` into `extra`, and
 * sanitizing before the merge would resurrect host markers.
 */
export function hermeticSpawnEnv(extra?: Readonly<Record<string, string>>): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    Object.assign(env, extra ?? {});
    for (const key of TERMINAL_IDENTITY_VARS) delete env[key];
    env.TERM = "xterm-256color";
    return env;
}
