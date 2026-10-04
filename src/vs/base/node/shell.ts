import { userInfo } from "node:os";

/**
 * Шелл системы по умолчанию — единственная точка «какой шелл запускать» (upstream
 * `base/node/shell.ts` `getSystemShell`). Встроенный терминал спавнит его и
 * подписывает им вкладку.
 *
 * Unix: `$SHELL` → шелл учётной записи (`/etc/passwd`) → `sh`; `/bin/false`
 * (учётка без входа) заменяется на `/bin/bash`, иначе терминал сразу бы
 * завершился. Windows: `%COMSPEC%` → `cmd.exe` (обнаружение PowerShell, как у
 * upstream, — не делаем).
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

/** Пустая строка в переменной окружения — то же, что её отсутствие. */
function nonEmpty(value: string | null | undefined): string | null | undefined {
    return value === "" ? undefined : value;
}

function accountShell(readUserInfo: () => { readonly shell: string | null }): string | null {
    try {
        return readUserInfo().shell;
    } catch {
        // `userInfo` бросает SystemError, если у пользователя нет имени или домашнего каталога.
        return null;
    }
}
