import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ILogger } from "../../log/common/iLogger.ts";

import { getShellIntegrationInjection, type IShellIntegrationHost } from "./terminalEnvironment.ts";

const SCRIPTS = "/app/scripts";

function logger() {
    return {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        isEnabled: () => true,
    } satisfies ILogger;
}

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

function inject(executable: string | undefined, args?: readonly string[], env: Record<string, string> = {}) {
    const log = logger();
    const result = getShellIntegrationInjection(
        { executable, args },
        { enabled: true, scriptsDir: SCRIPTS },
        env,
        log,
        host,
    );
    return { result, log };
}

describe("getShellIntegrationInjection — refusals", () => {
    it("the setting is off — before anything else", () => {
        const result = getShellIntegrationInjection(
            { executable: "/bin/bash", args: [], isFeatureTerminal: true },
            { enabled: false, scriptsDir: SCRIPTS },
            {},
            logger(),
        );
        expect(result).toEqual({ type: "failure", reason: "injectionSettingDisabled" });
    });

    it("no executable", () => {
        expect(inject(undefined).result).toEqual({ type: "failure", reason: "noExecutable" });
        expect(inject("").result).toEqual({ type: "failure", reason: "noExecutable" });
    });

    it("a task terminal", () => {
        const result = getShellIntegrationInjection(
            { executable: "/bin/bash", args: undefined, isFeatureTerminal: true },
            { enabled: true, scriptsDir: SCRIPTS },
            {},
            logger(),
        );
        expect(result).toEqual({ type: "failure", reason: "featureTerminal" });
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

    it("another shell — a warning with the executable and args", () => {
        const { result, log } = inject("/bin/sh", ["-c", "x"]);
        expect(result).toEqual({ type: "failure", reason: "unsupportedShell" });
        expect(log.warn).toHaveBeenCalledWith('Shell integration cannot be enabled for executable "/bin/sh" and args', [
            "-c",
            "x",
        ]);
    });
});

describe("getShellIntegrationInjection — bash", () => {
    it("no arguments: --init-file with the script, VSCODE_INJECTION and VSCODE_STABLE, no login flag", () => {
        expect(inject("/usr/bin/bash").result).toStrictEqual({
            type: "injection",
            newArgs: ["--init-file", path.join(SCRIPTS, "shellIntegration-bash.sh")],
            envMixin: { VSCODE_INJECTION: "1", VSCODE_STABLE: "1" },
        });
        expect(inject("/usr/bin/bash", []).result).toMatchObject({ type: "injection" });
    });

    it("login arguments (any case, with -i/--interactive alongside) — the same script plus VSCODE_SHELL_LOGIN", () => {
        for (const args of [["-l"], ["--login"], ["-L"], ["-i", "-l"], ["--login", "--interactive"]]) {
            expect(inject("bash", args).result, args.join(" ")).toStrictEqual({
                type: "injection",
                newArgs: ["--init-file", path.join(SCRIPTS, "shellIntegration-bash.sh")],
                envMixin: { VSCODE_INJECTION: "1", VSCODE_SHELL_LOGIN: "1", VSCODE_STABLE: "1" },
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
