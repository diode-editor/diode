import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { findShell } from "../src/TestUtils/findShell.ts";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

// node-pty is unix-only in the current packaging (like the `terminal` scenario).
const describeLinux = process.platform === "linux" ? describe : describe.skip;

describeLinux("shell integration scripts — SEA", () => {
    beforeAll(async () => {
        await getBinaryPath();
    }, 300_000);

    it("the binary unpacks the scripts into a cache path with spaces and bash starts with them", async () => {
        const cacheHome = mkdtempSync(join(tmpdir(), "diode cache with spaces "));
        const { session } = await useHeadlessApp({
            env: { SHELL: "/bin/bash", PS1: "diode$ ", PROMPT_COMMAND: "", XDG_CACHE_HOME: cacheHome },
        });
        await session.waitForReady();
        await session.sendKey("Ctrl+K");
        await session.sendKey("t");
        // The runner's system bashrc may set its own prompt over `PS1`: any prompt will do.
        await session.waitForText((t) => /\$ *$/m.test(t));
        // The marker is split in the command text, so it appears whole only in the output.
        await session.sendText('declare -F __vsc_precmd && echo "si""-$BASH_VERSION"');
        await session.sendKey("Enter");
        await session.waitForText((t) => t.includes("si-"));

        const root = join(cacheHome, "diode", "shell-integration");
        const [dir] = readdirSync(root).filter((name) => !name.endsWith(".lock"));
        expect(existsSync(join(root, dir, ".diode-ready"))).toBe(true);
        expect(existsSync(join(root, dir, "shellIntegration-bash.sh"))).toBe(true);
        expect(existsSync(join(root, dir, "shellIntegration-rc.zsh"))).toBe(true);
        expect(existsSync(join(root, dir, "shellIntegration.fish"))).toBe(true);
        expect(existsSync(join(root, dir, "shellIntegration.ps1"))).toBe(true);
    }, 120_000);

    // CI installs fish and has pwsh in the runner image; without the shell its case is skipped.
    for (const { name, check } of [
        { name: "fish", check: 'functions -q __vsc_cmd_finished; and echo "si""-$VSCODE_INJECTION"' },
        { name: "pwsh", check: "if (Get-Command __VSCode-Escape-Value) { 'si' + '-' + $env:VSCODE_INJECTION }" },
    ]) {
        const shell = findShell(name);
        it.skipIf(shell === undefined)(
            `${name} starts with the unpacked script from a cache path with spaces`,
            async () => {
                const cacheHome = mkdtempSync(join(tmpdir(), "diode cache with spaces "));
                const { session } = await useHeadlessApp({
                    env: { SHELL: shell ?? "", XDG_CACHE_HOME: cacheHome, POWERSHELL_TELEMETRY_OPTOUT: "1" },
                });
                await session.waitForReady();
                await session.sendKey("Ctrl+K");
                await session.sendKey("t");
                // fish's prompt ends with `> `, pwsh's with `> ` too; PSReadLine drops an Enter typed before it.
                await session.waitForText((t) => /> *$/m.test(t), { timeoutMs: 30_000 });
                await session.sendText(check);
                await session.sendKey("Enter");
                await session.waitForText((t) => t.includes("si-1"), { timeoutMs: 30_000 });
            },
            120_000,
        );
    }
});
