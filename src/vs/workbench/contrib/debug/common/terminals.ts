/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/node/terminals.ts
// `prepareCommand` only, in `common`: it is string work. `hasChildProcesses` spawns `pgrep` and lives in
// `../node/terminals.ts`. Upstream reads the OS from `platform.isWindows` (and `getDriveLetter` from `extpath`); here
// it is a parameter defaulting to the current OS, so the Windows branches are testable anywhere.

import { currentOperatingSystem, OperatingSystem } from "../../../../base/common/platform.ts";

export type ShellType = "cmd" | "powershell" | "bash";

/** Upstream `extpath.getDriveLetter`. */
function getDriveLetter(path: string, isWindowsOS: boolean): string | undefined {
    return isWindowsOS && /^[a-zA-Z]:/u.test(path) ? path[0] : undefined;
}

/** Upstream inlines this ladder in `prepareCommand` and again for the `clear` command of a reused terminal. */
export function shellTypeOf(
    shell: string,
    isWindowsOS: boolean = currentOperatingSystem() === OperatingSystem.Windows,
): ShellType {
    // Upstream also trims: `includes` doesn't care about the blanks around the path.
    shell = shell.toLowerCase();
    if (shell.includes("powershell") || shell.includes("pwsh")) {
        return "powershell";
    } else if (shell.includes("cmd.exe")) {
        return "cmd";
    } else if (shell.includes("bash")) {
        return "bash";
    }
    // pick a good default for Windows, a good default for anything else
    return isWindowsOS ? "cmd" : "bash";
}

export function prepareCommand(
    shell: string,
    args: readonly string[],
    argsCanBeInterpretedByShell: boolean,
    cwd?: string,
    env?: Readonly<Record<string, string | null>>,
    isWindowsOS: boolean = currentOperatingSystem() === OperatingSystem.Windows,
): string {
    // try to determine the shell type
    const shellType = shellTypeOf(shell, isWindowsOS);

    // begin command with a space to avoid polluting shell history
    let command = " ";

    switch (shellType) {
        case "powershell": {
            const quote = (s: string): string => {
                s = s.replace(/'/gu, "''");
                if (s.endsWith("\\")) {
                    return `'${s}\\'`;
                }
                return `'${s}'`;
            };

            if (cwd !== undefined && cwd !== "") {
                const driveLetter = getDriveLetter(cwd, isWindowsOS);
                if (driveLetter !== undefined) {
                    command += `${driveLetter}:; `;
                }
                command += `cd ${quote(cwd)}; `;
            }
            if (env) {
                for (const [key, value] of Object.entries(env)) {
                    if (value === null) {
                        command += `Remove-Item env:${key}; `;
                    } else {
                        command += `\${env:${key}}='${value}'; `;
                    }
                }
            }
            if (args.length > 0) {
                const [first, ...rest] = args;
                const cmd = argsCanBeInterpretedByShell ? first : quote(first);
                command += cmd.startsWith("'") ? `& ${cmd} ` : `${cmd} `;
                for (const a of rest) {
                    command += a === "<" || a === ">" || argsCanBeInterpretedByShell ? a : quote(a);
                    command += " ";
                }
            }
            break;
        }

        case "cmd": {
            const quote = (s: string): string => {
                // Note: Wrapping in cmd /C "..." complicates the escaping.
                // cmd /C "node -e "console.log(process.argv)" """A^>0"""" # prints "A>0"
                // cmd /C "node -e "console.log(process.argv)" "foo^> bar"" # prints foo> bar
                // Outside of the cmd /C, it could be a simple quoting, but here, the ^ is needed too
                s = s.replace(/"/gu, '""');
                s = s.replace(/([><!^&|])/gu, "^$1");
                return s.includes(" ") || s.includes('"') || s.length === 0 ? `"${s}"` : s;
            };

            if (cwd !== undefined && cwd !== "") {
                const driveLetter = getDriveLetter(cwd, isWindowsOS);
                if (driveLetter !== undefined) {
                    command += `${driveLetter}: && `;
                }
                command += `cd ${quote(cwd)} && `;
            }
            if (env) {
                command += 'cmd /C "';
                for (const [key, value] of Object.entries(env)) {
                    if (value === null) {
                        command += `set "${key}=" && `;
                    } else {
                        command += `set "${key}=${value.replace(/[&^|<>]/gu, (s) => `^${s}`)}" && `;
                    }
                }
            }
            for (const a of args) {
                command += a === "<" || a === ">" || argsCanBeInterpretedByShell ? a : quote(a);
                command += " ";
            }
            if (env) {
                command += '"';
            }
            break;
        }

        case "bash": {
            const quote = (s: string): string => {
                s = s.replace(/(["'\\$!><#()[\]*&^| ;{}?`])/gu, "\\$1");
                return s.length === 0 ? `""` : s;
            };

            const hardQuote = (s: string): string => {
                return /[^\w@%/+=,.:^-]/u.test(s) ? `'${s.replace(/'/gu, "'\\''")}'` : s;
            };

            if (cwd !== undefined && cwd !== "") {
                command += `cd ${quote(cwd)} ; `;
            }
            if (env) {
                command += "/usr/bin/env";
                for (const [key, value] of Object.entries(env)) {
                    if (value === null) {
                        command += ` -u ${hardQuote(key)}`;
                    } else {
                        command += ` ${hardQuote(`${key}=${value}`)}`;
                    }
                }
                command += " ";
            }
            for (const a of args) {
                command += a === "<" || a === ">" || argsCanBeInterpretedByShell ? a : quote(a);
                command += " ";
            }
            break;
        }
    }

    return command;
}
