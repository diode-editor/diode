import { execFile } from "node:child_process";

/**
 * Under tmux our own `process.env` is frozen at session creation, while the client may have
 * reattached from another machine. For `#{client_termtype}` tmux itself queries XTVERSION; `show-environment`
 * sees LC_DIODE_PLATFORM only if the user has `set -ag update-environment "LC_DIODE_PLATFORM"`.
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
        // Stryker disable next-line ObjectLiteral: the timeout guards against a hung tmux; a hang does not reproduce in unit tests.
        execFile("tmux", [...args], { timeout: TMUX_TIMEOUT_MS }, (error, stdout) => {
            resolve(error ? undefined : stdout);
        });
    });

/** `NAME=value` from `tmux show-environment NAME`; `-NAME` (removed) and errors yield undefined. */
export function parseShowEnvironment(output: string | undefined, name: string): string | undefined {
    // Stryker disable next-line StringLiteral: a replacement without the `NAME=` prefix yields the same undefined — an equivalent mutant.
    const line = output?.trim() ?? "";
    const prefix = `${name}=`;
    return line.startsWith(prefix) ? line.slice(prefix.length) : undefined;
}

function nonEmpty(value: string | undefined): string | undefined {
    const trimmed = value?.trim() ?? "";
    return trimmed === "" ? undefined : trimmed;
}

/** Queries tmux about the current client; never throws. */
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
