import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ILogger } from "../../../../platform/log/common/iLogger.ts";

import { type EmbeddedTerminalOptions, EmbeddedTerminalSession } from "./embeddedTerminalSession.ts";

/** The raw PTY output: the emulator swallows OSC 633, the shell integration script is seen only here. */
class RecordingSession extends EmbeddedTerminalSession {
    public raw = "";

    protected override feedOutput(data: string): void {
        this.raw += data;
        super.feedOutput(data);
    }
}

const BASH = "/bin/bash";
const ZSH = ["/usr/bin/zsh", "/bin/zsh"].find((p) => existsSync(p));
const WAIT = { timeout: 10_000, interval: 50 };
const PROMPT_START = "\x1b]633;A\x07";

let home: string;
let tmp: string;
const sessions: EmbeddedTerminalSession[] = [];

beforeEach(() => {
    home = mkdtempSync(path.join(os.tmpdir(), "diode-si-home-"));
    tmp = mkdtempSync(path.join(os.tmpdir(), "diode-si-tmp-"));
    // `os.tmpdir()` reads TMPDIR on every call: the zsh ZDOTDIR goes here, not into the machine's /tmp.
    vi.stubEnv("TMPDIR", tmp);
    // Upstream takes the user ZDOTDIR fallback from `os.homedir()` of the editor process, not the terminal env.
    vi.stubEnv("HOME", home);
});
afterEach(() => {
    for (const session of sessions.splice(0)) session.dispose();
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
    rmSync(tmp, { recursive: true, force: true });
});

function start(options: Partial<EmbeddedTerminalOptions>, logger?: ILogger): RecordingSession {
    const session = new RecordingSession(
        { cols: 100, rows: 10, cwd: home, env: { HOME: home, ZDOTDIR: null }, ...options },
        undefined,
        logger,
    );
    sessions.push(session);
    return session;
}

async function run(session: RecordingSession, command: string, expected: string): Promise<void> {
    session.write(`${command}\r`);
    await vi.waitFor(() => {
        expect(session.raw).toContain(expected);
    }, WAIT);
}

describe("EmbeddedTerminalSession — shell integration injection, bash", () => {
    it("the script reports the prompt and the command's exit code; the user's .bashrc still runs", async () => {
        writeFileSync(path.join(home, ".bashrc"), "alias diodealias='echo from-bashrc'\n");
        const session = start({ shell: BASH, shellIntegrationEnabled: true });
        await vi.waitFor(() => {
            expect(session.raw).toContain(PROMPT_START);
        }, WAIT);
        await run(session, "true", "\x1b]633;D;0\x07");
        await run(session, "false", "\x1b]633;D;1\x07");
        // The script consumes `VSCODE_INJECTION` (unsets it); its functions stay.
        await run(session, 'declare -F __vsc_precmd && echo "fn-$((40 + 2))"', "fn-42");
        await run(session, "diodealias", "from-bashrc");
    }, 30_000);

    it("login arguments — injected too; the script runs the login profile instead of .bashrc", async () => {
        writeFileSync(path.join(home, ".bash_profile"), "echo profile-$((1 + 1))\n");
        writeFileSync(path.join(home, ".bashrc"), "echo bashrc-$((1 + 1))\n");
        const session = start({ shell: BASH, args: ["-l"], shellIntegrationEnabled: true });
        await vi.waitFor(() => {
            expect(session.raw).toContain(PROMPT_START);
        }, WAIT);
        expect(session.raw).toContain("profile-2");
        expect(session.raw).not.toContain("bashrc-2");
    }, 30_000);

    it("relaunch — injected again", async () => {
        const session = start({ shell: BASH, shellIntegrationEnabled: true });
        await vi.waitFor(() => {
            expect(session.raw).toContain(PROMPT_START);
        }, WAIT);
        const exited = new Promise<void>((resolve) => {
            session.onExit(() => {
                resolve();
            });
        });
        session.write("exit\r");
        await exited;
        session.raw = "";
        session.relaunch({ shell: BASH, cwd: home, env: { HOME: home }, shellIntegrationEnabled: true });
        await vi.waitFor(() => {
            expect(session.raw).toContain(PROMPT_START);
        }, WAIT);
    }, 30_000);

    it("the setting off, a task terminal, custom arguments — the shell runs as is", async () => {
        const warn = vi.fn();
        const logger = { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn, error: vi.fn(), isEnabled: () => true };
        const cases: Partial<EmbeddedTerminalOptions>[] = [
            { shellIntegrationEnabled: false },
            { shellIntegrationEnabled: true, isFeatureTerminal: true },
            { shellIntegrationEnabled: true, args: ["--norc", "-i"] },
        ];
        for (const options of cases) {
            const session = start({ shell: BASH, ...options }, logger);
            await run(session, 'echo "[${VSCODE_INJECTION:-none}]"', "[none]");
            expect(session.raw).not.toContain(PROMPT_START);
        }
        // Unsupported args are not a warning upstream — only an unknown shell is.
        expect(warn).not.toHaveBeenCalled();
    }, 30_000);
});

describe("EmbeddedTerminalSession — VSCODE_NONCE", () => {
    const printNonce = { shell: "/bin/sh", args: ["-c", 'echo "<$VSCODE_NONCE>"'] };

    async function nonceOf(session: RecordingSession): Promise<string> {
        let nonce = "";
        await vi.waitFor(() => {
            const match = /<([0-9a-f-]{36})>/.exec(session.raw);
            expect(match).not.toBeNull();
            nonce = match![1];
        }, WAIT);
        return nonce;
    }

    it("set even without the injection; one per terminal, the same after a relaunch", async () => {
        const first = start(printNonce);
        const second = start(printNonce);
        const nonce = await nonceOf(first);
        expect(await nonceOf(second)).not.toBe(nonce);
        await new Promise<void>((resolve) => {
            first.onExit(() => {
                resolve();
            });
        });
        first.raw = "";
        first.relaunch(printNonce);
        expect(await nonceOf(first)).toBe(nonce);
    }, 30_000);
});

describe.skipIf(ZSH === undefined)("EmbeddedTerminalSession — shell integration injection, zsh", () => {
    // Without zsh the suite is skipped: CI installs it (`.github/workflows/ci.yml`).
    const zsh = ZSH ?? "";
    const zdotdir = () => path.join(tmp, `${os.userInfo().username}-diode-zsh`);

    it("ZDOTDIR is ours in TMPDIR, the script reports the prompt and exit code, the user's .zshrc runs", async () => {
        writeFileSync(path.join(home, ".zshrc"), "alias diodealias='echo from-zshrc'\n");
        const session = start({ shell: zsh, shellIntegrationEnabled: true });
        await vi.waitFor(() => {
            expect(session.raw).toContain(PROMPT_START);
        }, WAIT);
        await run(session, "true", "\x1b]633;D;0\x07");
        await run(session, "diodealias", "from-zshrc");
        await run(session, 'echo "<$ZDOTDIR>"', `<${home}>`);
        expect(existsSync(path.join(zdotdir(), ".zshrc"))).toBe(true);
    }, 30_000);

    it("the user's own ZDOTDIR — its .zshrc runs", async () => {
        const own = path.join(home, "zdot");
        mkdirSync(own);
        writeFileSync(path.join(own, ".zshrc"), "alias diodealias='echo from-own-zdotdir'\n");
        const session = start({ shell: zsh, env: { HOME: home, ZDOTDIR: own }, shellIntegrationEnabled: true });
        await vi.waitFor(() => {
            expect(session.raw).toContain(PROMPT_START);
        }, WAIT);
        await run(session, "diodealias", "from-own-zdotdir");
    }, 30_000);

    it("a script that cannot be copied is skipped — the shell still starts with the injection env", async () => {
        mkdirSync(path.join(zdotdir(), ".zlogin"), { recursive: true });
        const session = start({ shell: zsh, shellIntegrationEnabled: true });
        await vi.waitFor(() => {
            expect(session.raw).toContain(PROMPT_START);
        }, WAIT);
    }, 30_000);
});
