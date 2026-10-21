import { describe, expect, it } from "vitest";

import { buildShellCommandLine, shellArgsOf } from "./terminalTaskSystem.ts";

const linux = (
    command: Parameters<typeof buildShellCommandLine>[3],
    args: Parameters<typeof buildShellCommandLine>[5] = [],
    original = command,
) => buildShellCommandLine("linux", "/bin/bash", undefined, command, original, args);

describe("buildShellCommandLine — posix", () => {
    it("a string without args — as is, even with spaces and quotes", () => {
        expect(linux("echo a b; exit 3")).toBe("echo a b; exit 3");
    });

    it("resolution changed a string without spaces in the source — it is escaped", () => {
        expect(linux("my tool", [], "${env:TOOL}")).toBe("'my tool'");
        expect(linux("tool", [], "${env:TOOL}")).toBe("tool");
        // A source with spaces goes as is.
        expect(linux("echo x", [], "echo ${env:X}")).toBe("echo x");
    });

    it("args: with a space — strong, already quoted — as is; `\\ ` does not help in bash (as upstream)", () => {
        expect(linux("cmd", ["a b", "'c d'", '"e f"', "g\\ h", "x'y z'"])).toBe(
            "cmd 'a b' 'c d' \"e f\" 'g\\ h' x'y z'",
        );
    });

    it("quote inside: a space inside open quotes does not count, after closing — it does", () => {
        expect(linux("cmd", ["'a b'c d"])).toBe("cmd ''a b'c d'");
        expect(linux("cmd", ['a"b c"'])).toBe('cmd a"b c"');
        expect(linux("cmd", ["'"])).toBe("cmd '");
    });

    it("'already quoted' — only when the same quote opens and closes the value", () => {
        // Opened and closed with strong: as is, even though there is a space between the quotes.
        expect(linux("cmd", ["'a' 'b'"])).toBe("cmd 'a' 'b'");
        // Opened and closed with weak: also as is.
        expect(linux("cmd", ['"a" "b"'])).toBe('cmd "a" "b"');
        // Opened with weak, closed with strong: not "quoted", so the outer space is escaped.
        expect(linux("cmd", ['"a" b\''])).toBe("cmd '\"a\" b''");
        // Without an opening quote the value's ending does not matter.
        expect(linux("cmd", ["say undefined"])).toBe("cmd 'say undefined'");
    });

    it("escape: a comma is escaped too (the upstream character class is joined with commas)", () => {
        expect(linux("cmd", [{ value: "a,b", quoting: "escape" }])).toBe("cmd a\\,b");
    });

    it("no rule for the quoting kind — the value as is, not replaced by another rule", () => {
        expect(
            buildShellCommandLine("linux", "/bin/bash", { quoting: { escape: "^" } }, "c", "c", [
                { value: "a b", quoting: "strong" },
            ]),
        ).toBe("c a b");
    });

    it("shell paths follow the task OS rules: on posix a backslash is part of the name", () => {
        // `x\\powershell` on posix is not powershell: OS rules (bash).
        expect(
            buildShellCommandLine("linux", "/opt/x\\powershell", undefined, "c", "c", [
                { value: "a b", quoting: "escape" },
            ]),
        ).toBe("c a\\ b");
        // pwsh on posix gets no `&`: that is Windows-only.
        expect(buildShellCommandLine("linux", "/usr/bin/pwsh", undefined, "my cmd", "my cmd", ["x"])).toBe(
            "'my cmd' x",
        );
    });

    it("explicit rule: strong, weak, escape (per the bash table)", () => {
        expect(
            linux("cmd", [
                { value: "a b", quoting: "strong" },
                { value: "a b", quoting: "weak" },
                { value: "a 'b\" c", quoting: "escape" },
            ]),
        ).toBe("cmd 'a b' \"a b\" a\\ \\'b\\\"\\ c");
        expect(linux({ value: "my cmd", quoting: "weak" })).toBe('"my cmd"');
    });

    it("unknown shell — OS rules; zsh — like bash", () => {
        expect(buildShellCommandLine("linux", "/usr/bin/fish", undefined, "c", "c", ["a b"])).toBe("c 'a b'");
        expect(buildShellCommandLine("osx", "/bin/zsh", undefined, "c", "c", ["a b"])).toBe("c 'a b'");
    });

    it("own rules from options.shell.quoting; escape as a string; without the needed rule — as is", () => {
        const quoting = { escape: "^", strong: "<", weak: ">" };
        expect(
            buildShellCommandLine("linux", "/bin/bash", { quoting }, "c", "c", [
                "a b",
                { value: "x y", quoting: "escape" },
                { value: "w", quoting: "weak" },
            ]),
        ).toBe("c <a b< x^ y >w>");
        expect(
            buildShellCommandLine("linux", "/bin/bash", { quoting: {} }, "c", "c", [
                { value: "a b", quoting: "strong" },
                { value: "a b", quoting: "weak" },
                { value: "a b", quoting: "escape" },
                "s t",
            ]),
        ).toBe("c a b a b a b s t");
    });

    it("the rule's escape character skips the next character when looking for a space", () => {
        expect(
            buildShellCommandLine("linux", "/bin/bash", { quoting: { escape: "\\", strong: "'" } }, "c", "c", [
                "a\\ b",
            ]),
        ).toBe("c a\\ b");
    });
});

describe("buildShellCommandLine — Windows", () => {
    it("cmd: quoted command and argument — the whole line is quoted", () => {
        expect(buildShellCommandLine("windows", "C:\\Windows\\cmd.exe", undefined, "my cmd", "my cmd", ["a b"])).toBe(
            '""my cmd" "a b""',
        );
        expect(buildShellCommandLine("windows", "cmd.exe", undefined, "cmd", "cmd", ["a b"])).toBe('cmd "a b"');
        // Unquoted args: the line is not wrapped, even if the command is quoted.
        expect(buildShellCommandLine("windows", "cmd.exe", undefined, "my cmd", "my cmd", ["x", "y"])).toBe(
            '"my cmd" x y',
        );
        // escape as a string from the shell's own rules also counts as "quoted".
        expect(
            buildShellCommandLine(
                "windows",
                "cmd.exe",
                { quoting: { escape: "^", strong: '"' } },
                { value: "a b", quoting: "escape" },
                "a b",
                ["c d"],
            ),
        ).toBe('"a^ b "c d""');
    });

    it("powershell/pwsh: a quoted command — via `&`; escape — with a backtick", () => {
        expect(buildShellCommandLine("windows", "powershell.exe", undefined, "my cmd", "my cmd", ["x"])).toBe(
            "& 'my cmd' x",
        );
        expect(
            buildShellCommandLine("windows", "pwsh.exe", undefined, { value: "c", quoting: "strong" }, "c", []),
        ).toBe("& 'c'");
        expect(
            buildShellCommandLine("windows", "pwsh", undefined, "c", "c", [{ value: "a (b)", quoting: "escape" }]),
        ).toBe("c a` `(b`)");
        // Quoted command and argument: powershell uses `&`, not cmd quotes.
        expect(buildShellCommandLine("windows", "powershell.exe", undefined, "my cmd", "my cmd", ["a b"])).toBe(
            "& 'my cmd' 'a b'",
        );
        // weak and escape on the command also count as "quoted"; without a rule for that kind they don't.
        expect(buildShellCommandLine("windows", "pwsh.exe", undefined, { value: "c", quoting: "weak" }, "c", [])).toBe(
            '& "c"',
        );
        expect(
            buildShellCommandLine("windows", "pwsh.exe", undefined, { value: "a b", quoting: "escape" }, "a b", []),
        ).toBe("& a` b");
        expect(
            buildShellCommandLine("windows", "pwsh.exe", { quoting: {} }, { value: "c", quoting: "strong" }, "c", []),
        ).toBe("c");
        // An unknown shell on Windows uses powershell rules, but without `&`.
        expect(buildShellCommandLine("windows", "sh.exe", undefined, "my c", "my c", ["x"])).toBe("'my c' x");
    });
});

describe("shellArgsOf", () => {
    const shell = (executable: string, args: string[] = [], specified = false) => ({ executable, args, specified });

    it("posix: `-c` and the command line; a configured shell — without `-c`", () => {
        expect(shellArgsOf("linux", shell("/bin/bash"), "make")).toStrictEqual(["-c", "make"]);
        expect(shellArgsOf("osx", shell("/bin/zsh", ["-l"]), "make")).toStrictEqual(["-l", "-c", "make"]);
        expect(shellArgsOf("linux", shell("/bin/zsh", ["-i"], true), "make")).toStrictEqual(["-i", "make"]);
    });

    it("`-c` is not duplicated if already present; present with a tail of non-flags — it is added", () => {
        expect(shellArgsOf("linux", shell("/bin/bash", ["-c"]), "x")).toStrictEqual(["-c", "x"]);
        expect(shellArgsOf("linux", shell("/bin/bash", ["-C", "-l"]), "x")).toStrictEqual(["-C", "-l", "x"]);
        expect(shellArgsOf("linux", shell("/bin/bash", ["-c", "-l"]), "x")).toStrictEqual(["-c", "-l", "x"]);
        expect(shellArgsOf("linux", shell("/bin/bash", ["-c", "y"]), "x")).toStrictEqual(["-c", "y", "-c", "x"]);
        // The tail is checked only for `-c` itself: flags after other args don't count.
        expect(shellArgsOf("linux", shell("/bin/bash", ["-l", "-i"]), "x")).toStrictEqual(["-l", "-i", "-c", "x"]);
        expect(shellArgsOf("linux", shell("/bin/bash", ["y", "-c", "-l"]), "x")).toStrictEqual(["y", "-c", "-l", "x"]);
        // A tail of flags only: yes; at least one non-flag: `-c` is added.
        expect(shellArgsOf("linux", shell("/bin/bash", ["-c", "-l", "y"]), "x")).toStrictEqual([
            "-c",
            "-l",
            "y",
            "-c",
            "x",
        ]);
    });

    it("Windows: by shell", () => {
        expect(shellArgsOf("windows", shell("C:\\x\\PowerShell.exe"), "c")).toStrictEqual(["-Command", "c"]);
        expect(shellArgsOf("windows", shell("pwsh.exe"), "c")).toStrictEqual(["-Command", "c"]);
        expect(shellArgsOf("windows", shell("bash.exe"), "c")).toStrictEqual(["-c", "c"]);
        expect(shellArgsOf("windows", shell("zsh.exe"), "c")).toStrictEqual(["-c", "c"]);
        expect(shellArgsOf("windows", shell("nu.exe"), "c")).toStrictEqual(["-c", "c"]);
        expect(shellArgsOf("windows", shell("wsl.exe"), "c")).toStrictEqual(["-e", "c"]);
        expect(shellArgsOf("windows", shell("cmd.exe"), "c")).toStrictEqual(["/d", "/c", "c"]);
    });
});
