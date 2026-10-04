import { describe, expect, it } from "vitest";

import { getSystemShell } from "./shell.ts";

/** Учётная запись с заданным шеллом (`null` — шелла в /etc/passwd нет). */
const account = (shell: string | null) => () => ({ shell });
const noAccount = (): never => {
    throw new Error("user has no username or homedir");
};

describe("getSystemShell", () => {
    it("unix: $SHELL важнее шелла учётной записи", () => {
        expect(getSystemShell("linux", { SHELL: "/usr/bin/zsh" }, account("/bin/bash"))).toBe("/usr/bin/zsh");
        expect(getSystemShell("darwin", { SHELL: "/bin/zsh" }, noAccount)).toBe("/bin/zsh");
    });

    it("unix: без $SHELL (или с пустым) — шелл учётной записи", () => {
        expect(getSystemShell("linux", {}, account("/bin/fish"))).toBe("/bin/fish");
        expect(getSystemShell("linux", { SHELL: "" }, account("/bin/fish"))).toBe("/bin/fish");
    });

    it("unix: нет ни $SHELL, ни шелла учётки (или учётку не прочитать) — sh", () => {
        expect(getSystemShell("linux", {}, account(null))).toBe("sh");
        expect(getSystemShell("linux", {}, account(""))).toBe("sh");
        expect(getSystemShell("linux", {}, noAccount)).toBe("sh");
    });

    it("unix: /bin/false (учётка без входа) заменяется на /bin/bash", () => {
        expect(getSystemShell("linux", { SHELL: "/bin/false" }, noAccount)).toBe("/bin/bash");
        expect(getSystemShell("linux", {}, account("/bin/false"))).toBe("/bin/bash");
    });

    it("windows: %COMSPEC%, без него — cmd.exe; $SHELL не смотрится", () => {
        expect(getSystemShell("win32", { COMSPEC: "C:\\Windows\\system32\\cmd.exe", SHELL: "/bin/bash" })).toBe(
            "C:\\Windows\\system32\\cmd.exe",
        );
        expect(getSystemShell("win32", { SHELL: "/bin/bash" })).toBe("cmd.exe");
        expect(getSystemShell("win32", { COMSPEC: "" })).toBe("cmd.exe");
    });

    it("по умолчанию — платформа и окружение процесса, учётка читается настоящим userInfo", () => {
        expect(getSystemShell()).not.toBe("");
        expect(getSystemShell("linux", {})).not.toBe("");
    });
});
