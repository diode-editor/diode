// Герметичная терминальная идентичность спаунов e2e. Keyboard-tier, truecolor и
// режимы ssh/tmux приложение выводит из env (`terminalEnvironmentModel`), а
// headless-бэкенд пробу протокола никогда не резолвит — env-baseline финален.
// Унаследованные от хоста маркеры машинозависимы (kitty ssh-kitten внутри tmux
// даёт `KITTY_WINDOW_ID` → tier csi-u, на CI — legacy), а от tier'а зависит,
// какие аккорды вообще активны (`when: "tier == 'legacy'"` у chord-фоллбэков
// палитры) и что рисует статус-бар на скриншотах. Поэтому каждый спаун бинаря
// пинуется к одному baseline: tier=legacy, mode=local, TERM=xterm-256color.

/**
 * Переменные, по которым `terminalEnvironmentModel` детектит extended-keys
 * (маркеры kitty/ghostty/wezterm/alacritty), truecolor и режимы ssh/tmux.
 */
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
] as const;

/**
 * Собирает env спауна: наследует `process.env`, накладывает `extra` (сессии
 * передают сюда как полный env из `prepareAppEnv`, так и частичные патчи вроде
 * `homeIsolationEnv`), и ПОСЛЕДНИМ шагом пинует терминальную идентичность.
 * Последним — намеренно: часть вызывающих спредит в `extra` целый `process.env`,
 * и санитизация раньше мержа воскресила бы маркеры хоста.
 */
export function hermeticSpawnEnv(extra?: Readonly<Record<string, string>>): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    Object.assign(env, extra ?? {});
    for (const key of TERMINAL_IDENTITY_VARS) delete env[key];
    env.TERM = "xterm-256color";
    return env;
}
