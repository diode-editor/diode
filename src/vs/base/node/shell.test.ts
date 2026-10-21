import { describe, expect, it } from "vitest";

import { getSystemShell } from "./shell.ts";

/** An account with the given shell (`null` means no shell in /etc/passwd). */
const account = (shell: string | null) => () => ({ shell });
const noAccount = (): never => {
    throw new Error("user has no username or homedir");
};

describe("getSystemShell", () => {
    it("unix: $SHELL wins over the account shell", () => {
        expect(getSystemShell("linux", { SHELL: "/usr/bin/zsh" }, account("/bin/bash"))).toBe("/usr/bin/zsh");
        expect(getSystemShell("darwin", { SHELL: "/bin/zsh" }, noAccount)).toBe("/bin/zsh");
    });

    it("unix: without $SHELL (or with an empty one), the account shell", () => {
        expect(getSystemShell("linux", {}, account("/bin/fish"))).toBe("/bin/fish");
        expect(getSystemShell("linux", { SHELL: "" }, account("/bin/fish"))).toBe("/bin/fish");
    });

    it("unix: neither $SHELL nor an account shell (or the account is unreadable): sh", () => {
        expect(getSystemShell("linux", {}, account(null))).toBe("sh");
        expect(getSystemShell("linux", {}, account(""))).toBe("sh");
        expect(getSystemShell("linux", {}, noAccount)).toBe("sh");
    });

    it("unix: /bin/false (no-login account) is replaced by /bin/bash", () => {
        expect(getSystemShell("linux", { SHELL: "/bin/false" }, noAccount)).toBe("/bin/bash");
        expect(getSystemShell("linux", {}, account("/bin/false"))).toBe("/bin/bash");
    });

    it("windows: %COMSPEC%, otherwise cmd.exe; $SHELL is ignored", () => {
        expect(getSystemShell("win32", { COMSPEC: "C:\\Windows\\system32\\cmd.exe", SHELL: "/bin/bash" })).toBe(
            "C:\\Windows\\system32\\cmd.exe",
        );
        expect(getSystemShell("win32", { SHELL: "/bin/bash" })).toBe("cmd.exe");
        expect(getSystemShell("win32", { COMSPEC: "" })).toBe("cmd.exe");
    });

    it("defaults to the process platform and environment; the account is read via the real userInfo", () => {
        expect(getSystemShell()).not.toBe("");
        expect(getSystemShell("linux", {})).not.toBe("");
    });
});
