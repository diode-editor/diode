import { describe, expect, it } from "vitest";

import { prepareCommand } from "./terminals.ts";

// Upstream's `test/node/terminals.test.ts` verbatim, then the cwd/env prefixes and the OS defaults it doesn't cover.

function run(shell: string, args: string[], interpreted: boolean): string {
    return prepareCommand(shell, args, interpreted, undefined, undefined, false).trim();
}

describe("Debug - prepareCommand", () => {
    it("bash", () => {
        expect(run("bash", ["{$} ("], false)).toBe("\\{\\$\\}\\ \\(");
        expect(run("bash", ["hello", "world", "--flag=true"], false)).toBe("hello world --flag=true");
        expect(run("bash", [" space arg "], false)).toBe("\\ space\\ arg\\");

        expect(run("bash", ["{$} ("], true)).toBe("{$} (");
        expect(run("bash", ["hello", "world", "--flag=true"], true)).toBe("hello world --flag=true");
        expect(run("bash", [" space arg "], true)).toBe("space arg");
    });

    it("bash - do not escape > and <", () => {
        expect(run("bash", ["arg1", ">", "> hello.txt", "<", "<input.in"], false)).toBe(
            "arg1 > \\>\\ hello.txt < \\<input.in",
        );
    });

    it("cmd", () => {
        expect(run("cmd.exe", ["^!< "], false)).toBe('"^^^!^< "');
        expect(run("cmd.exe", ["hello", "world", "--flag=true"], false)).toBe("hello world --flag=true");
        expect(run("cmd.exe", [" space arg "], false)).toBe('" space arg "');
        expect(run("cmd.exe", ['"A>0"'], false)).toBe('"""A^>0"""');
        expect(run("cmd.exe", [""], false)).toBe('""');

        expect(run("cmd.exe", ["^!< "], true)).toBe("^!<");
        expect(run("cmd.exe", ["hello", "world", "--flag=true"], true)).toBe("hello world --flag=true");
        expect(run("cmd.exe", [" space arg "], true)).toBe("space arg");
        expect(run("cmd.exe", ['"A>0"'], true)).toBe('"A>0"');
        expect(run("cmd.exe", [""], true)).toBe("");
    });

    it("cmd - do not escape > and <", () => {
        expect(run("cmd.exe", ["arg1", ">", "> hello.txt", "<", "<input.in"], false)).toBe(
            'arg1 > "^> hello.txt" < ^<input.in',
        );
    });

    it("powershell", () => {
        expect(run("powershell", ["!< "], false)).toBe(`& '!< '`);
        expect(run("powershell", ["hello", "world", "--flag=true"], false)).toBe(`& 'hello' 'world' '--flag=true'`);
        expect(run("powershell", [" space arg "], false)).toBe(`& ' space arg '`);
        expect(run("powershell", ['"A>0"'], false)).toBe(`& '"A>0"'`);
        expect(run("powershell", [""], false)).toBe(`& ''`);

        expect(run("powershell", ["!< "], true)).toBe("!<");
        expect(run("powershell", ["hello", "world", "--flag=true"], true)).toBe("hello world --flag=true");
        expect(run("powershell", [" space arg "], true)).toBe("space arg");
        expect(run("powershell", ['"A>0"'], true)).toBe('"A>0"');
        expect(run("powershell", [""], true)).toBe(``);
    });

    it("powershell - do not escape > and <", () => {
        expect(run("powershell", ["arg1", ">", "> hello.txt", "<", "<input.in"], false)).toBe(
            `& 'arg1' > '> hello.txt' < '<input.in'`,
        );
    });

    it("starts with a space (kept out of the shell history) and ends each argument with one", () => {
        expect(prepareCommand("/bin/bash", ["a", "b"], false, undefined, undefined, false)).toBe(" a b ");
        expect(prepareCommand("bash", [], false, undefined, undefined, false)).toBe(" ");
    });

    it("powershell quotes: a single quote doubles, a trailing backslash is escaped, pwsh is powershell", () => {
        expect(run("pwsh", ["it's", "dir\\"], false)).toBe(`& 'it''s' 'dir\\\\'`);
        expect(run("/usr/bin/PWSH ", ["x"], false)).toBe(`& 'x'`);
    });

    it("bash: cwd is a cd, env goes through /usr/bin/env, null unsets, odd names and values are hard-quoted", () => {
        expect(
            prepareCommand("/bin/bash", ["./a.out"], false, "/home/my dir", { A: "1", B: null, "C D": "it's" }, false),
        ).toBe(" cd /home/my\\ dir ; /usr/bin/env A=1 -u B 'C D=it'\\''s' ./a.out ");
        expect(prepareCommand("bash", ["x"], false, "", undefined, false)).toBe(" x ");
        expect(prepareCommand("bash", ["x"], false, undefined, { "a@b%c/d+e,f.g:h^i-j": "v" }, false)).toBe(
            " /usr/bin/env a@b%c/d+e,f.g:h^i-j=v x ",
        );
    });

    it("powershell: the drive, then cd, then env assignments and removals", () => {
        expect(prepareCommand("powershell", ["x"], false, "C:\\work", { A: "1", B: null }, true)).toBe(
            " C:; cd 'C:\\work'; ${env:A}='1'; Remove-Item env:B; & 'x' ",
        );
        expect(prepareCommand("powershell", ["x"], false, "/work", undefined, true)).toBe(" cd '/work'; & 'x' ");
        expect(prepareCommand("powershell", ["x"], false, "C:\\work", undefined, false)).toBe(" cd 'C:\\work'; & 'x' ");
    });

    it("cmd: the drive, then cd, env wraps the command in cmd /C with escaped values", () => {
        expect(prepareCommand("cmd.exe", ["x"], false, "D:\\my work", { A: "a&b<c", B: null }, true)).toBe(
            ' D: && cd "D:\\my work" && cmd /C "set "A=a^&b^<c" && set "B=" && x "',
        );
        expect(prepareCommand("cmd.exe", ["x"], false, "\\work", undefined, true)).toBe(" cd \\work && x ");
    });

    it("an unknown shell is cmd on Windows and bash elsewhere", () => {
        expect(prepareCommand("/bin/zsh", ["a b"], false, undefined, undefined, true)).toBe(' "a b" ');
        expect(prepareCommand("/bin/zsh", ["a b"], false, undefined, undefined, false)).toBe(" a\\ b ");
    });

    it("defaults to the OS of the process", () => {
        const onWindows = process.platform === "win32";
        expect(prepareCommand("/bin/zsh", ["a b"], false)).toBe(onWindows ? ' "a b" ' : " a\\ b ");
    });
});
