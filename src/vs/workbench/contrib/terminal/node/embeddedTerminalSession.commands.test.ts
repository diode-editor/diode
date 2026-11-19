import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { findShell } from "../../../../../TestUtils/findShell.ts";
import type { ITerminalCommand } from "../../../../platform/terminal/common/capabilities/capabilities.ts";

import { EmbeddedTerminalSession } from "./embeddedTerminalSession.ts";

// The command model fed by the real injected scripts: what an extension will read as shell executions.

const BASH = "/bin/bash";
const ZSH = ["/usr/bin/zsh", "/bin/zsh"].find((p) => existsSync(p));
// Without the shell its suite is skipped: CI installs zsh and fish and has pwsh (`.github/workflows/ci.yml`).
const FISH = findShell("fish");
const PWSH = findShell("pwsh");
// pwsh is a .NET app: its first start on a cold runner takes seconds.
const WAIT = { timeout: 20_000, interval: 50 };
const EXECUTED = "\x1b]633;C\x07";

let home: string;
let tmp: string;
const sessions: EmbeddedTerminalSession[] = [];

beforeEach(() => {
    home = realpathSync(mkdtempSync(path.join(os.tmpdir(), "diode-si-cmd-home-")));
    tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "diode-si-cmd-tmp-")));
    vi.stubEnv("TMPDIR", tmp);
});
afterEach(() => {
    for (const session of sessions.splice(0)) session.dispose();
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

interface IRecorded {
    readonly session: EmbeddedTerminalSession;
    readonly finished: ITerminalCommand[];
    readonly output: Map<ITerminalCommand, string>;
    integrationOn: number;
}

function start(shell: string): IRecorded {
    const session = new EmbeddedTerminalSession({
        cols: 100,
        rows: 10,
        shell,
        cwd: home,
        // Debian's zshrc runs `compinit` unless told not to; on a CI runner it would ask about insecure directories.
        env: {
            HOME: home,
            HISTFILE: "/dev/null",
            ZDOTDIR: home,
            skip_global_compinit: "1",
            XDG_CONFIG_HOME: path.join(home, ".config"),
            XDG_DATA_HOME: path.join(home, ".local/share"),
            XDG_CACHE_HOME: path.join(home, ".cache"),
            fish_history: "",
            POWERSHELL_TELEMETRY_OPTOUT: "1",
            POWERSHELL_UPDATECHECK: "Off",
        },
        shellIntegrationEnabled: true,
    });
    sessions.push(session);
    const recorded: IRecorded = { session, finished: [], output: new Map(), integrationOn: 0 };
    session.shellIntegration.capabilities.onDidAddCommandDetectionCapability((detection) => {
        recorded.integrationOn++;
        detection.onCommandFinished((command) => recorded.finished.push(command));
    });
    session.shellIntegration.onDidWriteCommandOutput(({ command, data }) => {
        recorded.output.set(command, (recorded.output.get(command) ?? "") + data);
    });
    return recorded;
}

async function run(recorded: IRecorded, line: string): Promise<ITerminalCommand> {
    const before = recorded.finished.length;
    recorded.session.write(`${line}\r`);
    await vi.waitFor(() => {
        expect(recorded.finished.length).toBeGreaterThan(before);
    }, WAIT);
    return recorded.finished[before];
}

async function waitForIntegration(recorded: IRecorded): Promise<void> {
    await vi.waitFor(() => {
        expect(recorded.integrationOn).toBe(1);
    }, WAIT);
}

/**
 * `echoOutputTail` — what follows `hi\r\n` in the output: nothing for bash; zsh prints its PROMPT_SP (the inverse `%`
 * mark of an unterminated line, then spaces) before `D`, so there it belongs to the output, as upstream. `undefined` —
 * only `hi` is checked (fish and pwsh redraw their line editor around the output).
 */
function commandsTest(shell: string, echoOutputTail: string | undefined) {
    return async () => {
        const dir = path.join(tmp, "work dir");
        mkdirSync(dir);
        const recorded = start(shell);
        await waitForIntegration(recorded);
        const cd = await run(recorded, `cd '${dir}'`);
        const echo = await run(recorded, "echo hi");
        const fail = await run(recorded, "false");
        expect(
            [cd, echo, fail].map((c) => [c.command, c.exitCode, c.isTrusted, c.commandLineConfidence]),
        ).toStrictEqual([
            [`cd '${dir}'`, 0, true, "high"],
            ["echo hi", 0, true, "high"],
            ["false", 1, true, "high"],
        ]);
        expect([cd.cwd, echo.cwd, fail.cwd]).toStrictEqual([home, dir, dir]);
        const echoOutput = recorded.output.get(echo) ?? "";
        expect(echoOutput.startsWith(EXECUTED)).toBe(true);
        expect(echoOutput).toContain("hi\r\n");
        if (echoOutputTail !== undefined)
            expect(echoOutput.startsWith(`${EXECUTED}hi\r\n${echoOutputTail}`)).toBe(true);
        if (echoOutputTail === "") expect(echoOutput).toBe(`${EXECUTED}hi\r\n`);
        const cwd = recorded.session.shellIntegration.capabilities.get("cwdDetection");
        // The 1.127.0 scripts send `P;Cwd` without the nonce: untrusted, as upstream.
        expect([cwd?.getCwd(), cwd?.isTrusted]).toStrictEqual([dir, false]);
        // An empty Enter is a command with no line and no exit code; integration came on once.
        const empty = await run(recorded, "");
        expect([empty.command, empty.exitCode]).toStrictEqual(["", undefined]);
        expect(recorded.integrationOn).toBe(1);
    };
}

describe("EmbeddedTerminalSession — shell integration commands, bash", () => {
    it(
        "cd, echo hi, false — three trusted commands, their exit codes, cwds and output",
        commandsTest(BASH, ""),
        30_000,
    );

    it("a multi-line command (continuation prompt) is one command", async () => {
        const recorded = start(BASH);
        await waitForIntegration(recorded);
        recorded.session.write("echo 'a\r");
        const command = await run(recorded, "b'");
        expect([command.command, command.exitCode]).toStrictEqual(["echo 'a\nb'", 0]);
        expect(recorded.output.get(command)).toBe(`${EXECUTED}a\r\nb\r\n`);
    }, 30_000);

    it("relaunch: integration comes on again for the new shell", async () => {
        const recorded = start(BASH);
        await waitForIntegration(recorded);
        const exited = new Promise<void>((resolve) =>
            recorded.session.onExit(() => {
                resolve();
            }),
        );
        recorded.session.write("exit\r");
        await exited;
        recorded.session.relaunch({ shell: BASH, cwd: home, env: { HOME: home }, shellIntegrationEnabled: true });
        await vi.waitFor(() => {
            expect(recorded.integrationOn).toBe(2);
        }, WAIT);
        const echo = await run(recorded, "echo again");
        expect(echo.command).toBe("echo again");
    }, 30_000);

    it("environmentReporting on: the shell reports its environment, trusted", async () => {
        const session = new EmbeddedTerminalSession({
            cols: 100,
            rows: 10,
            shell: BASH,
            cwd: home,
            env: { HOME: home, HISTFILE: "/dev/null" },
            shellIntegrationEnabled: true,
            shellIntegrationEnvironmentReporting: true,
        });
        sessions.push(session);
        await vi.waitFor(() => {
            const env = session.shellIntegration.capabilities.get("shellEnvDetection")?.env;
            expect(env?.value.HOME).toBe(home);
            expect(env?.isTrusted).toBe(true);
        }, WAIT);
    }, 30_000);

    it("environmentReporting off (the default): no environment", async () => {
        const recorded = start(BASH);
        await waitForIntegration(recorded);
        await run(recorded, "true");
        expect(recorded.session.shellIntegration.capabilities.has("shellEnvDetection")).toBe(false);
    }, 30_000);
});

describe.skipIf(ZSH === undefined)("EmbeddedTerminalSession — shell integration commands, zsh", () => {
    // Without zsh the suite is skipped: CI installs it (`.github/workflows/ci.yml`).
    it(
        "cd, echo hi, false — three trusted commands, their exit codes, cwds and output",
        commandsTest(ZSH ?? "", "\x1b[1m\x1b[7m%"),
        30_000,
    );
});

describe.skipIf(FISH === undefined)("EmbeddedTerminalSession — shell integration commands, fish", () => {
    it(
        "cd, echo hi, false — three trusted commands, their exit codes, cwds and output",
        commandsTest(FISH ?? "", undefined),
        60_000,
    );
});

describe.skipIf(PWSH === undefined)("EmbeddedTerminalSession — shell integration commands, pwsh", () => {
    it(
        "cd, echo hi, false — three trusted commands, their exit codes, cwds and output",
        commandsTest(PWSH ?? "", undefined),
        60_000,
    );
});
