import { posix, win32 } from "node:path";

import { OperatingSystem } from "../../../base/common/platform.ts";

/** Upstream `TerminalShellType` (`PosixShellType`, `WindowsShellType`, `GeneralShellType`): `terminal.state.shell`. */
export type TerminalShellType =
    | "bash"
    | "csh"
    | "fish"
    | "ksh"
    | "sh"
    | "zsh"
    | "cmd"
    | "gitbash"
    | "wsl"
    | "julia"
    | "node"
    | "nu"
    | "pwsh"
    | "python"
    | "xonsh";

const GENERAL_SHELL_TYPES: readonly (readonly [TerminalShellType, RegExp])[] = [
    ["julia", /^julia$/u],
    ["node", /^node$/u],
    ["nu", /^nu$/u],
    // Upstream's pattern verbatim: the alternation is unanchored, so `pwsh.exe` and `windowspowershell` match too.
    ["pwsh", /^pwsh(-preview)?|powershell$/u],
    ["python", /^py(?:thon)?$/u],
    ["xonsh", /^xonsh/u],
];

const WINDOWS_SHELL_TYPES: readonly (readonly [TerminalShellType, RegExp])[] = [
    ["cmd", /^cmd$/u],
    ["gitbash", /^bash$/u],
    ["wsl", /^wsl$/u],
];

const POSIX_SHELL_TYPES: readonly TerminalShellType[] = ["bash", "csh", "fish", "ksh", "sh", "zsh"];

/**
 * Upstream `guessShellTypeFromExecutable` (`terminalInstance.ts`): the executable's basename against a table. As
 * upstream, the basename keeps its extension, so `cmd.exe` stays unknown.
 */
export function guessShellTypeFromExecutable(os: OperatingSystem, executable: string): TerminalShellType | undefined {
    const name = (os === OperatingSystem.Windows ? win32 : posix).basename(executable);
    for (const [type, pattern] of GENERAL_SHELL_TYPES) if (pattern.test(name)) return type;
    if (os === OperatingSystem.Windows) {
        for (const [type, pattern] of WINDOWS_SHELL_TYPES) if (pattern.test(name)) return type;
        return undefined;
    }
    return POSIX_SHELL_TYPES.find((type) => type === name);
}
