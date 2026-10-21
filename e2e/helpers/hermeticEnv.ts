// Каждый спаун пинуется к одному baseline (tier=legacy, mode=local, TERM=xterm-256color):
// headless-бэкенд пробу протокола не резолвит, и унаследованные маркеры хоста (kitty в tmux →
// tier csi-u, на CI — legacy) меняли бы активные аккорды и статус-бар на скриншотах.

/** По ним `terminalEnvironmentModel` детектит extended-keys, truecolor и ssh/tmux. */
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
    // ОС клавиатуры (мак-раскладка) — сценарий задаёт её явно через keyboard.platform.
    "LC_DIODE_PLATFORM",
    "LC_TERMINAL",
] as const;

/**
 * Идентичность пинуется ПОСЛЕДНЕЙ: часть вызывающих спредит в `extra` целый `process.env`, и
 * санитизация раньше мержа воскресила бы маркеры хоста.
 */
export function hermeticSpawnEnv(extra?: Readonly<Record<string, string>>): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    Object.assign(env, extra ?? {});
    for (const key of TERMINAL_IDENTITY_VARS) delete env[key];
    env.TERM = "xterm-256color";
    return env;
}
