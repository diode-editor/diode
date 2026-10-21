import { userInfo } from "node:os";

/**
 * `/bin/false` (a no-login account) is replaced with `/bin/bash`, otherwise the terminal
 * would exit right away.
 */
export function getSystemShell(
    platform: NodeJS.Platform = process.platform,
    env: NodeJS.ProcessEnv = process.env,
    readUserInfo: () => { readonly shell: string | null } = userInfo,
): string {
    if (platform === "win32") return nonEmpty(env.COMSPEC) ?? "cmd.exe";
    const shell = nonEmpty(env.SHELL) ?? nonEmpty(accountShell(readUserInfo)) ?? "sh";
    return shell === "/bin/false" ? "/bin/bash" : shell;
}

function nonEmpty(value: string | null | undefined): string | null | undefined {
    return value === "" ? undefined : value;
}

// Stryker disable BlockStatement: an empty catch would return undefined, the same as null for the caller's `??`
function accountShell(readUserInfo: () => { readonly shell: string | null }): string | null {
    try {
        return readUserInfo().shell;
    } catch {
        // `userInfo` throws a SystemError if the user has no name or home directory.
        return null;
    }
}
// Stryker restore BlockStatement
