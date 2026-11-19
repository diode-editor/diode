import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeLogger } from "../../../../../TestUtils/configurationLayersFixture.ts";
import { findShell, PROMPT_START, RecordingSession } from "../../../../../TestUtils/shellIntegrationSession.ts";

import type { EmbeddedTerminalOptions } from "./embeddedTerminalSession.ts";

// Without the shell the suite is skipped: CI installs fish and has pwsh in the runner image (`.github/workflows/ci.yml`).
const FISH = findShell("fish");
const PWSH = findShell("pwsh");
// pwsh is a .NET app: its first start on a cold runner takes seconds.
const WAIT = { timeout: 20_000, interval: 50 };

let home: string;
const sessions: RecordingSession[] = [];

beforeEach(() => {
    // A space in the path: the user's config is found through it, like the scripts dir in the cache.
    home = mkdtempSync(path.join(os.tmpdir(), "diode si home "));
});
afterEach(() => {
    for (const session of sessions.splice(0)) session.dispose();
    // A killed shell may still be writing into its home for a moment.
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

function start(options: Partial<EmbeddedTerminalOptions>, logger = makeLogger()): RecordingSession {
    const session = new RecordingSession(
        {
            cols: 120,
            rows: 10,
            cwd: home,
            env: {
                HOME: home,
                XDG_CONFIG_HOME: path.join(home, ".config"),
                XDG_DATA_HOME: path.join(home, ".local/share"),
                XDG_CACHE_HOME: path.join(home, ".cache"),
                fish_history: "",
                POWERSHELL_TELEMETRY_OPTOUT: "1",
                POWERSHELL_UPDATECHECK: "Off",
            },
            ...options,
        },
        undefined,
        logger,
    );
    sessions.push(session);
    return session;
}

function userConfig(relative: string, content: string): void {
    const file = path.join(home, ".config", relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
}

async function waitForRaw(session: RecordingSession, expected: string): Promise<void> {
    await vi.waitFor(() => {
        expect(session.raw).toContain(expected);
    }, WAIT);
}

async function run(session: RecordingSession, command: string, expected: string): Promise<void> {
    session.write(`${command}\r`);
    await waitForRaw(session, expected);
}

describe.skipIf(FISH === undefined)("EmbeddedTerminalSession — shell integration injection, fish", () => {
    const fish = FISH ?? "";

    it("the script reports the prompt and the exit code; VSCODE_INJECTION and the user's config.fish are there", async () => {
        userConfig("fish/config.fish", "function diodefn; echo from-config-$argv; end\n");
        const session = start({ shell: fish, shellIntegrationEnabled: true });
        await waitForRaw(session, PROMPT_START);
        await run(session, "true", "\x1b]633;D;0\x07");
        await run(session, "false", "\x1b]633;D;1\x07");
        // The markers are split in the command text, so they appear whole only in the output.
        await run(session, 'echo "inj-""$VSCODE_INJECTION"', "inj-1");
        await run(session, 'functions -q __vsc_cmd_finished; and echo "fn""-ok"', "fn-ok");
        await run(session, "diodefn fish", "from-config-fish");
    }, 60_000);

    it("login arguments — injected too, the shell is a login one", async () => {
        const session = start({ shell: fish, args: ["-l"], shellIntegrationEnabled: true });
        await waitForRaw(session, PROMPT_START);
        await run(session, 'status is-login; and echo "log""in-yes"', "login-yes");
    }, 60_000);

    it("the setting off, a task terminal, custom arguments — the shell runs as is", async () => {
        const logger = makeLogger();
        const cases: Partial<EmbeddedTerminalOptions>[] = [
            { shellIntegrationEnabled: false },
            { shellIntegrationEnabled: true, isFeatureTerminal: true },
            { shellIntegrationEnabled: true, args: ["-i", "--no-config"] },
        ];
        const started = cases.map((options) => start({ shell: fish, ...options }, logger));
        await Promise.all(started.map((session) => run(session, 'echo "[""$VSCODE_INJECTION""]"', "[]")));
        for (const session of started) expect(session.raw).not.toContain(PROMPT_START);
        expect(logger.warn).not.toHaveBeenCalled();
    }, 60_000);
});

describe.skipIf(PWSH === undefined)("EmbeddedTerminalSession — shell integration injection, pwsh", () => {
    const pwsh = PWSH ?? "";

    it("the script reports the prompt and the exit code; VSCODE_INJECTION, its functions and $PROFILE are there", async () => {
        userConfig("powershell/Microsoft.PowerShell_profile.ps1", "function diodefn { 'from-profile-' + $args[0] }\n");
        const session = start({ shell: pwsh, shellIntegrationEnabled: true });
        await waitForRaw(session, PROMPT_START);
        await run(session, "true", "\x1b]633;D;0\x07");
        await run(session, "false", "\x1b]633;D;1\x07");
        await run(session, "'inj-' + $env:VSCODE_INJECTION", "inj-1");
        await run(session, "if (Get-Command __VSCode-Escape-Value) { 'fn' + '-ok' }", "fn-ok");
        await run(session, "diodefn pwsh", "from-profile-pwsh");
    }, 60_000);

    it("login arguments next to -NoLogo — injected too", async () => {
        const session = start({ shell: pwsh, args: ["-NoLogo", "-l"], shellIntegrationEnabled: true });
        await waitForRaw(session, PROMPT_START);
    }, 60_000);

    it("custom arguments — the shell runs as is", async () => {
        const session = start({ shell: pwsh, args: ["-NoProfile"], shellIntegrationEnabled: true });
        // PSReadLine drops an Enter typed before it draws the prompt.
        await waitForRaw(session, "PS ");
        await run(session, "'[' + $env:VSCODE_INJECTION + ']'", "[]");
        expect(session.raw).not.toContain(PROMPT_START);
    }, 60_000);
});
