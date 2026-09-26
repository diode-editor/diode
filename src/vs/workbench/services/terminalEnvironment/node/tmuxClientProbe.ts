import { execFile } from "node:child_process";

/**
 * Живые сведения о клиенте tmux. Свой `process.env` под tmux читать нельзя: он
 * застыл на момент создания сессии, а клиент мог с тех пор переподключиться с
 * другой машины. tmux же знает про текущего клиента:
 *  - `#{client_termtype}` — tmux сам опрашивает внешний терминал (XTVERSION),
 *    напр. `kitty(0.45.0)`, `iTerm2 3.5.0`;
 *  - `show-environment` — переменные, обновлённые при attach. LC_DIODE_PLATFORM
 *    туда попадает, только если у пользователя
 *    `set -ag update-environment "LC_DIODE_PLATFORM"`.
 */
export interface TmuxClientInfo {
    readonly termType?: string;
    readonly envPlatform?: string;
    readonly lcTerminal?: string;
}

/** Выполняет `tmux <args>` и отдаёт stdout (или undefined при любой ошибке). */
export type TmuxRunner = (args: readonly string[]) => Promise<string | undefined>;

const TMUX_TIMEOUT_MS = 1000;

export const runTmux: TmuxRunner = (args) =>
    new Promise((resolve) => {
        execFile("tmux", [...args], { timeout: TMUX_TIMEOUT_MS }, (error, stdout) => {
            resolve(error ? undefined : stdout);
        });
    });

/** `NAME=value` из `tmux show-environment NAME`; `-NAME` (удалена) и ошибки — undefined. */
export function parseShowEnvironment(output: string | undefined, name: string): string | undefined {
    const line = output?.trim() ?? "";
    const prefix = `${name}=`;
    return line.startsWith(prefix) ? line.slice(prefix.length) : undefined;
}

function nonEmpty(value: string | undefined): string | undefined {
    const trimmed = value?.trim() ?? "";
    return trimmed === "" ? undefined : trimmed;
}

/** Опрашивает tmux про текущего клиента; никогда не бросает. */
export async function queryTmuxClient(run: TmuxRunner = runTmux): Promise<TmuxClientInfo> {
    const [termType, platform, lcTerminal] = await Promise.all([
        run(["display-message", "-p", "#{client_termtype}"]),
        run(["show-environment", "LC_DIODE_PLATFORM"]),
        run(["show-environment", "LC_TERMINAL"]),
    ]);
    return {
        termType: nonEmpty(termType),
        envPlatform: parseShowEnvironment(platform, "LC_DIODE_PLATFORM"),
        lcTerminal: parseShowEnvironment(lcTerminal, "LC_TERMINAL"),
    };
}
