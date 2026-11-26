import { describe, expect, it } from "vitest";

import { OperatingSystem } from "../../../base/common/platform.ts";

import { guessShellTypeFromExecutable } from "./terminalShellType.ts";

describe("guessShellTypeFromExecutable — upstream's table", () => {
    it.each([
        ["/bin/bash", "bash"],
        ["/bin/csh", "csh"],
        ["/usr/bin/fish", "fish"],
        ["/bin/ksh", "ksh"],
        ["/bin/sh", "sh"],
        ["/usr/bin/zsh", "zsh"],
        ["/usr/local/bin/pwsh", "pwsh"],
        ["/usr/local/bin/pwsh-preview", "pwsh"],
        ["/usr/bin/python", "python"],
        ["/usr/bin/py", "python"],
        ["/usr/bin/node", "node"],
        ["/usr/bin/nu", "nu"],
        ["/usr/bin/julia", "julia"],
        ["/usr/bin/xonsh3", "xonsh"],
        ["zsh", "zsh"],
    ])("POSIX %s → %s", (executable, type) => {
        expect(guessShellTypeFromExecutable(OperatingSystem.Linux, executable)).toBe(type);
    });

    it.each([
        ["/bin/bash5"],
        ["/usr/bin/python3"],
        ["/opt/my-shell"],
        ["/bin/cmd"],
        ["/usr/bin/wsl"],
        ["/bin/"],
        ["C:\\x\\bash"],
    ])("POSIX %s → unknown", (executable) => {
        expect(guessShellTypeFromExecutable(OperatingSystem.Macintosh, executable)).toBeUndefined();
    });

    it.each([
        ["C:\\Windows\\System32\\cmd", "cmd"],
        ["C:\\Program Files\\Git\\bin\\bash", "gitbash"],
        ["C:/Windows/System32/wsl", "wsl"],
        ["C:\\Program Files\\PowerShell\\7\\pwsh.exe", "pwsh"],
        ["C:\\Windows\\WindowsPowerShell\\v1.0\\powershell", "pwsh"],
        ["C:\\tools\\node", "node"],
    ])("Windows %s → %s", (executable, type) => {
        expect(guessShellTypeFromExecutable(OperatingSystem.Windows, executable)).toBe(type);
    });

    it.each([["C:\\Windows\\System32\\cmd.exe"], ["C:\\Program Files\\Git\\bin\\bash.exe"], ["C:\\x\\zsh"]])(
        "Windows %s → unknown (the extension is kept, as upstream)",
        (executable) => {
            expect(guessShellTypeFromExecutable(OperatingSystem.Windows, executable)).toBeUndefined();
        },
    );
});
