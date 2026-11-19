import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeLogger } from "../../../../TestUtils/configurationLayersFixture.ts";

import {
    getShellIntegrationInjection,
    type IShellIntegrationHost,
    type IShellIntegrationLaunchConfig,
} from "./terminalEnvironment.ts";

const SCRIPTS = "/app/scripts";

let tmp: string;
let host: IShellIntegrationHost;

beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "diode-si-"));
    host = {
        tmpdir: () => tmp,
        userInfo: () => ({ username: "alice" }),
        homedir: () => "/home/alice",
    };
});
afterEach(() => {
    chmodSync(tmp, 0o700);
    rmSync(tmp, { recursive: true, force: true });
});

function inject(
    executable: string | undefined,
    args?: readonly string[],
    env: Record<string, string> = {},
    overrides: { enabled?: boolean; isFeatureTerminal?: boolean } = {},
) {
    const log = makeLogger();
    const scriptsDir = vi.fn(() => SCRIPTS);
    const launch: IShellIntegrationLaunchConfig = { executable, args, isFeatureTerminal: overrides.isFeatureTerminal };
    const result = getShellIntegrationInjection(
        launch,
        { enabled: overrides.enabled ?? true, scriptsDir },
        env,
        log,
        host,
    );
    return { result, log, scriptsDir };
}

describe("getShellIntegrationInjection — refusals", () => {
    it("the setting is off — before anything else; a refusal never asks for the scripts", () => {
        const { result, scriptsDir } = inject("/bin/bash", [], {}, { enabled: false, isFeatureTerminal: true });
        expect(result).toEqual({ type: "failure", reason: "injectionSettingDisabled" });
        expect(scriptsDir).not.toHaveBeenCalled();
    });

    it("no executable", () => {
        expect(inject(undefined).result).toEqual({ type: "failure", reason: "noExecutable" });
        expect(inject("").result).toEqual({ type: "failure", reason: "noExecutable" });
    });

    it("a task terminal", () => {
        expect(inject("/bin/bash", undefined, {}, { isFeatureTerminal: true }).result).toEqual({
            type: "failure",
            reason: "featureTerminal",
        });
    });

    it("arguments other than none or a login set — bash and zsh, without touching ZDOTDIR", () => {
        for (const shell of ["/bin/bash", "/usr/bin/zsh"]) {
            for (const args of [["-c", "true"], ["-l", "-x"], ["-i"], ["--norc"]]) {
                expect(inject(shell, args).result, `${shell} ${args.join(" ")}`).toEqual({
                    type: "failure",
                    reason: "unsupportedArgs",
                });
            }
        }
        expect(existsSync(path.join(tmp, "alice-diode-zsh"))).toBe(false);
    });

    it("another shell — a warning with the executable and args, the scripts aren't asked for", () => {
        const { result, log, scriptsDir } = inject("/bin/sh", ["-c", "x"]);
        expect(result).toEqual({ type: "failure", reason: "unsupportedShell" });
        expect(log.warn).toHaveBeenCalledWith('Shell integration cannot be enabled for executable "/bin/sh" and args', [
            "-c",
            "x",
        ]);
        expect(scriptsDir).not.toHaveBeenCalled();
    });
});

describe("getShellIntegrationInjection — bash", () => {
    it("no arguments: --init-file with the script, VSCODE_INJECTION and VSCODE_STABLE, no login flag", () => {
        expect(inject("/usr/bin/bash").result).toStrictEqual({
            type: "injection",
            newArgs: ["--init-file", path.join(SCRIPTS, "shellIntegration-bash.sh")],
            envMixin: { VSCODE_INJECTION: "1", VSCODE_STABLE: "1" },
            filesToCopy: [],
        });
        expect(inject("/usr/bin/bash", []).result).toMatchObject({ type: "injection" });
    });

    it("login arguments (any case, with -i/--interactive alongside) — the same script plus VSCODE_SHELL_LOGIN", () => {
        for (const args of [["-l"], ["--login"], ["-L"], ["-i", "-l"], ["--login", "--interactive"]]) {
            expect(inject("bash", args).result, args.join(" ")).toStrictEqual({
                type: "injection",
                newArgs: ["--init-file", path.join(SCRIPTS, "shellIntegration-bash.sh")],
                envMixin: { VSCODE_INJECTION: "1", VSCODE_SHELL_LOGIN: "1", VSCODE_STABLE: "1" },
                filesToCopy: [],
            });
        }
    });
});

describe("getShellIntegrationInjection — zsh", () => {
    const zdotdir = () => path.join(tmp, "alice-diode-zsh");

    it("ZDOTDIR in the real tmp dir (created 0o1700), USER_ZDOTDIR is home, the four rc files to copy", () => {
        const { result } = inject("/usr/bin/zsh");
        expect(result).toStrictEqual({
            type: "injection",
            newArgs: ["-i"],
            envMixin: { VSCODE_INJECTION: "1", ZDOTDIR: zdotdir(), USER_ZDOTDIR: "/home/alice" },
            filesToCopy: [
                { source: path.join(SCRIPTS, "shellIntegration-rc.zsh"), dest: path.join(zdotdir(), ".zshrc") },
                { source: path.join(SCRIPTS, "shellIntegration-profile.zsh"), dest: path.join(zdotdir(), ".zprofile") },
                { source: path.join(SCRIPTS, "shellIntegration-env.zsh"), dest: path.join(zdotdir(), ".zshenv") },
                { source: path.join(SCRIPTS, "shellIntegration-login.zsh"), dest: path.join(zdotdir(), ".zlogin") },
            ],
        });
        expect(statSync(zdotdir()).mode & 0o7777).toBe(0o1700);
    });

    it("an existing directory gets the mode back; login args — -il; the user's own ZDOTDIR is kept", () => {
        mkdirSync(zdotdir(), { mode: 0o755 });
        const { result } = inject("zsh", ["--login"], { ZDOTDIR: "/home/alice/.config/zsh" });
        expect(result).toMatchObject({
            type: "injection",
            newArgs: ["-il"],
            envMixin: { ZDOTDIR: zdotdir(), USER_ZDOTDIR: "/home/alice/.config/zsh" },
        });
        expect(statSync(zdotdir()).mode & 0o7777).toBe(0o1700);
    });

    it("the tmp dir is a symlink — ZDOTDIR is under its real path", () => {
        const link = path.join(tmp, "link");
        mkdirSync(path.join(tmp, "real"));
        symlinkSync(path.join(tmp, "real"), link);
        host = { ...host, tmpdir: () => link };
        expect(inject("zsh").result).toMatchObject({
            envMixin: { ZDOTDIR: path.join(tmp, "real", "alice-diode-zsh") },
        });
    });

    it("no user name — `unknown`", () => {
        host = {
            ...host,
            userInfo: () => {
                throw new Error("no passwd entry");
            },
        };
        expect(inject("zsh").result).toMatchObject({ envMixin: { ZDOTDIR: path.join(tmp, "unknown-diode-zsh") } });
    });

    it("the tmp dir does not exist — failedToCreateTmpDir, logged", () => {
        host = { ...host, tmpdir: () => path.join(tmp, "missing") };
        const { result, log } = inject("zsh");
        expect(result).toEqual({ type: "failure", reason: "failedToCreateTmpDir" });
        expect(log.error).toHaveBeenCalledWith(expect.stringContaining("Failed to resolve the temp directory"));
    });

    it("the directory cannot be created — failedToCreateTmpDir, logged with the path", () => {
        chmodSync(tmp, 0o500);
        const { result, log } = inject("zsh");
        expect(result).toEqual({ type: "failure", reason: "failedToCreateTmpDir" });
        expect(log.error).toHaveBeenCalledWith(expect.stringContaining(`Failed to create zdotdir at ${zdotdir()}`));
    });

    it("the mode cannot be set (not a directory on the way) — failedToSetStickyBit, logged", () => {
        writeFileSync(path.join(tmp, "file"), "");
        host = { ...host, tmpdir: () => path.join(tmp, "file") };
        const { result, log } = inject("zsh");
        expect(result).toEqual({ type: "failure", reason: "failedToSetStickyBit" });
        expect(log.error).toHaveBeenCalledWith(expect.stringContaining("Failed to set sticky bit on"));
    });
});

describe("getShellIntegrationInjection — fish", () => {
    const source = `source "${path.join(SCRIPTS, "shellIntegration.fish")}"`;

    it("no arguments: --init-command sources the script (quoted), only VSCODE_INJECTION", () => {
        for (const args of [undefined, []]) {
            expect(inject("/usr/bin/fish", args).result).toStrictEqual({
                type: "injection",
                newArgs: ["--init-command", source],
                envMixin: { VSCODE_INJECTION: "1" },
                filesToCopy: [],
            });
        }
    });

    it("login arguments (any case, with -i alongside) — -l first", () => {
        for (const args of [["-l"], ["--LOGIN"], ["-i", "-l"]]) {
            expect(inject("fish", args).result, args.join(" ")).toStrictEqual({
                type: "injection",
                newArgs: ["-l", "--init-command", source],
                envMixin: { VSCODE_INJECTION: "1" },
                filesToCopy: [],
            });
        }
    });

    it("other arguments — unsupportedArgs, no warning", () => {
        for (const args of [["-c", "true"], ["-i"], ["-l", "-x"], ["--no-config"]]) {
            const { result, log } = inject("/usr/bin/fish", args);
            expect(result, args.join(" ")).toEqual({ type: "failure", reason: "unsupportedArgs" });
            expect(log.warn).not.toHaveBeenCalled();
        }
    });
});

describe("getShellIntegrationInjection — pwsh", () => {
    const dotSource = `. "${path.join(SCRIPTS, "shellIntegration.ps1")}"`;
    const injected = (newArgs: string[]) => ({
        type: "injection",
        newArgs,
        envMixin: { VSCODE_INJECTION: "1", VSCODE_STABLE: "1" },
        filesToCopy: [],
    });

    it("no arguments or only -nologo/-nol (any case): -noexit -command dot-sources the script, VSCODE_STABLE", () => {
        for (const args of [undefined, [], ["-nologo"], ["-NoLogo"], ["-nol"]]) {
            expect(inject("/usr/bin/pwsh", args).result, String(args)).toStrictEqual(
                injected(["-noexit", "-command", dotSource]),
            );
        }
    });

    it("login: -l or -login alone or next to -nologo in either order — -l first", () => {
        for (const args of [["-l"], ["-Login"], ["-l", "-nologo"], ["-NoLogo", "-login"], ["-nol", "-L"]]) {
            expect(inject("pwsh", args).result, args.join(" ")).toStrictEqual(
                injected(["-l", "-noexit", "-command", dotSource]),
            );
        }
    });

    it("other arguments — unsupportedArgs", () => {
        for (const args of [
            ["-c", "1"],
            ["--login"],
            ["-l", "-l"],
            ["-nologo", "-nologo"],
            ["-l", "-noprofile"],
            ["-noprofile", "-l"],
            ["-l", "-nologo", "-noprofile"],
            ["-noprofile"],
        ]) {
            expect(inject("/usr/bin/pwsh", args).result, args.join(" ")).toEqual({
                type: "failure",
                reason: "unsupportedArgs",
            });
        }
    });

    it("pwsh.exe and powershell are Windows branches upstream — unsupportedShell here", () => {
        expect(inject("/usr/bin/pwsh.exe").result).toEqual({ type: "failure", reason: "unsupportedShell" });
        expect(inject("/usr/bin/powershell").result).toEqual({ type: "failure", reason: "unsupportedShell" });
    });
});

describe("getShellIntegrationInjection — a scripts dir with spaces", () => {
    it("fish and pwsh keep the path quoted inside one argument", () => {
        const injectFrom = (executable: string) =>
            getShellIntegrationInjection(
                { executable, args: [] },
                { enabled: true, scriptsDir: () => "/cache dir/si" },
                {},
                makeLogger(),
                host,
            );
        expect(injectFrom("fish")).toMatchObject({
            newArgs: ["--init-command", 'source "/cache dir/si/shellIntegration.fish"'],
        });
        expect(injectFrom("pwsh")).toMatchObject({
            newArgs: ["-noexit", "-command", '. "/cache dir/si/shellIntegration.ps1"'],
        });
    });
});
