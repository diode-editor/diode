import { userInfo } from "node:os";

/**
 * `/bin/false` (учётка без входа) заменяется на `/bin/bash`, иначе терминал
 * сразу бы завершился.
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

// Stryker disable BlockStatement: пустой catch вернул бы undefined — для `??` у вызывающего то же, что null
function accountShell(readUserInfo: () => { readonly shell: string | null }): string | null {
    try {
        return readUserInfo().shell;
    } catch {
        // `userInfo` бросает SystemError, если у пользователя нет имени или домашнего каталога.
        return null;
    }
}
// Stryker restore BlockStatement
