import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

/**
 * The VT emulator is the lazy chunk `lazy/@xterm/headless.cjs`: the terminal session is created
 * immediately, the emulator once the chunk has loaded. This covers the race a unit test cannot fully
 * reproduce: several terminals and input before the chunk loads. A rejected code cache for the
 * chunk would surface in Bootstrap as an unexpected error.
 */

// node-pty is unix-only in the current packaging (like the `terminal` scenario).
const describeUnix = process.platform === "win32" ? describe.skip : describe;

describeUnix("встроенный терминал сразу после старта — SEA", () => {
    beforeAll(async () => {
        await getBinaryPath();
    }, 300_000);

    it("три терминала и набор команды до готовности редактора: вывод на экране, кэш кода принят", async () => {
        const { session } = await useHeadlessApp({
            files: { "a.txt": "hello\n" },
            open: ["a.txt"],
            env: { SHELL: "/bin/bash", PS1: "diode$ ", PROMPT_COMMAND: "" },
        });

        // The inspector comes up before extensions activate — commands go to an editor that
        // has not finished starting, without waiting for readiness or render idle.
        await session.executeCommand("workbench.action.terminal.new");
        await session.executeCommand("workbench.action.terminal.new");
        await session.executeCommand("workbench.action.terminal.new");
        // The marker is split by an empty substitution: it can appear whole only in the
        // shell output, not in the echo of the typed line.
        await session.sendText('echo lazy""-term-$((6*7))');
        await session.sendKey("Enter");

        const frame = await session.waitForText((text) => text.includes("lazy-term-42"), { timeoutMs: 30_000 });
        expect(frameToText(frame)).toContain("TERMINAL");

        expect(await session.nodes("#terminalTabsList TextLabelElement")).toHaveLength(3);

        const bootstrap = await session.getOutput("bootstrap");
        expect(bootstrap).not.toContain("unexpected error");
        expect(bootstrap).not.toContain("unhandled rejection");
    }, 120_000);
});
