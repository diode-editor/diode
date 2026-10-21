import { execFile } from "node:child_process";

/**
 * Свой `process.env` под tmux застыл на момент создания сессии, а клиент мог переподключиться
 * с другой машины. `#{client_termtype}` — tmux сам спрашивает XTVERSION; `show-environment`
 * видит LC_DIODE_PLATFORM, только если у пользователя `set -ag update-environment "LC_DIODE_PLATFORM"`.
 */
export interface TmuxClientInfo {
    readonly termType?: string;
    readonly envPlatform?: string;
    readonly lcTerminal?: string;
}

export type TmuxRunner = (args: readonly string[]) => Promise<string | undefined>;

const TMUX_TIMEOUT_MS = 1000;

export const runTmux: TmuxRunner = (args) =>
    new Promise((resolve) => {
        // Stryker disable next-line ObjectLiteral: таймаут — страховка от зависшего tmux; в юнитах зависание не воспроизводится.
        execFile("tmux", [...args], { timeout: TMUX_TIMEOUT_MS }, (error, stdout) => {
            resolve(error ? undefined : stdout);
        });
    });

/** `NAME=value` из `tmux show-environment NAME`; `-NAME` (удалена) и ошибки — undefined. */
export function parseShowEnvironment(output: string | undefined, name: string): string | undefined {
    // Stryker disable next-line StringLiteral: заменитель без префикса `NAME=` даёт тот же undefined — эквивалентный мутант.
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
