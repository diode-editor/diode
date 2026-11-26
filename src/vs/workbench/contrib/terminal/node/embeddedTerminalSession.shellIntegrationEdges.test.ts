import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeLogger } from "../../../../../TestUtils/configurationLayersFixture.ts";
import { findShell, PROMPT_START, RecordingSession } from "../../../../../TestUtils/shellIntegrationSession.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";

import type { EmbeddedTerminalOptions, EmbeddedTerminalSession } from "./embeddedTerminalSession.ts";

const ZSH = findShell("zsh");
const WAIT = { timeout: 10_000, interval: 50 };

// The user's ZDOTDIR goes through the terminal env: the fallback, `os.homedir()`, reads the process's real HOME — a
// stubbed one does not reach it in a worker thread (Stryker runs vitest in the `threads` pool). The fallback itself is
// covered by the port's unit test.
let home: string;
let tmp: string;
const sessions: EmbeddedTerminalSession[] = [];

beforeEach(() => {
    home = mkdtempSync(path.join(os.tmpdir(), "diode si home é-"));
    tmp = mkdtempSync(path.join(os.tmpdir(), "diode-si-tmp-"));
    vi.stubEnv("TMPDIR", tmp);
    vi.stubEnv("ZDOTDIR", undefined);
});
afterEach(() => {
    for (const session of sessions.splice(0)) session.dispose();
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

function start(options: Partial<EmbeddedTerminalOptions>, logger?: ILogger): RecordingSession {
    const session = new RecordingSession(
        {
            cols: 100,
            rows: 10,
            cwd: home,
            env: { HOME: home, HISTFILE: "/dev/null", ZDOTDIR: home, skip_global_compinit: "1" },
            ...options,
        },
        undefined,
        logger,
    );
    sessions.push(session);
    return session;
}

async function waitFor(session: RecordingSession, expected: string): Promise<void> {
    await vi.waitFor(() => {
        expect(session.raw).toContain(expected);
    }, WAIT);
}

async function run(session: RecordingSession, command: string, expected: string): Promise<void> {
    session.write(`${command}\r`);
    await waitFor(session, expected);
}

describe("shell integration — bash edges", () => {
    it.each([[["--login"]], [["-i", "-l"]], [["-l", "-i"]]])(
        "login arguments %j — injected",
        async (args) => {
            const session = start({ shell: "/bin/bash", args, shellIntegrationEnabled: true });
            await waitFor(session, PROMPT_START);
            await run(session, 'declare -F __vsc_precmd && echo "fn-$((40 + 2))"', "fn-42");
        },
        30_000,
    );

    it("a shell given by name, found on PATH — injected", async () => {
        const session = start({ shell: "bash", shellIntegrationEnabled: true });
        await waitFor(session, PROMPT_START);
    }, 30_000);

    it("the user's PROMPT_COMMAND array keeps working next to the script", async () => {
        writeFileSync(path.join(home, ".bashrc"), "PROMPT_COMMAND=('echo pc-$((1+1))')\n");
        const session = start({ shell: "/bin/bash", shellIntegrationEnabled: true });
        await waitFor(session, PROMPT_START);
        await run(session, "true", "pc-2");
    }, 30_000);

    it("an unsupported shell — runs as is, one warning", async () => {
        const logger = makeLogger();
        const session = start({ shell: "/bin/sh", shellIntegrationEnabled: true }, logger);
        await run(session, 'echo "[${VSCODE_INJECTION:-none}]"', "[none]");
        expect(logger.warn).toHaveBeenCalledTimes(1);
    }, 30_000);
});

describe.skipIf(ZSH === undefined)("shell integration — zsh edges", () => {
    const zsh = ZSH ?? "";
    const zdotdir = () => path.join(tmp, `${os.userInfo().username}-diode-zsh`);

    it("ZDOTDIR inherited from the editor's own environment (no terminal env override) — that .zshrc runs", async () => {
        const own = path.join(home, ".config", "zsh");
        mkdirSync(own, { recursive: true });
        writeFileSync(path.join(own, ".zshrc"), "alias diodealias='echo from-inherited-zdotdir'\n");
        vi.stubEnv("ZDOTDIR", own);
        const session = start({
            shell: zsh,
            env: { HOME: home, HISTFILE: "/dev/null", skip_global_compinit: "1" },
            shellIntegrationEnabled: true,
        });
        await waitFor(session, PROMPT_START);
        await run(session, "diodealias", "from-inherited-zdotdir");
        await run(session, 'echo "<$ZDOTDIR>"', `<${own}>`);
    }, 30_000);

    it("login arguments — injected; the user's .zshenv, .zprofile and .zlogin run", async () => {
        writeFileSync(path.join(home, ".zprofile"), "echo zprofile-$((1+1))\n");
        writeFileSync(path.join(home, ".zlogin"), "echo zlogin-$((1+1))\n");
        writeFileSync(path.join(home, ".zshenv"), "echo zshenv-$((1+1))\n");
        const session = start({ shell: zsh, args: ["-l"], shellIntegrationEnabled: true });
        await waitFor(session, PROMPT_START);
        await waitFor(session, "zlogin-2");
        expect(session.raw).toContain("zprofile-2");
        expect(session.raw).toContain("zshenv-2");
    }, 30_000);

    it("a home with spaces and unicode — the user's .zshrc runs", async () => {
        writeFileSync(path.join(home, ".zshrc"), "alias diodealias='echo from-zshrc-é'\n");
        const session = start({ shell: zsh, shellIntegrationEnabled: true });
        await waitFor(session, PROMPT_START);
        await run(session, "diodealias", "from-zshrc-é");
    }, 30_000);

    it("an existing ZDOTDIR left open to others is locked back to 0o1700", async () => {
        mkdirSync(zdotdir());
        chmodSync(zdotdir(), 0o777);
        const session = start({ shell: zsh, shellIntegrationEnabled: true });
        await waitFor(session, PROMPT_START);
        expect(statSync(zdotdir()).mode & 0o7777).toBe(0o1700);
    }, 30_000);

    it("two zsh terminals started at once — both injected", async () => {
        const first = start({ shell: zsh, shellIntegrationEnabled: true });
        const second = start({ shell: zsh, shellIntegrationEnabled: true });
        await waitFor(first, PROMPT_START);
        await waitFor(second, PROMPT_START);
    }, 30_000);
});
