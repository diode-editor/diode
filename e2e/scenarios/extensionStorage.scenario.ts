import { resolve } from "node:path";

import { frameToText } from "../helpers/frame.ts";

import type { ScenarioDriver } from "./framework.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// The `ext-storage-demo` fixture declares `alt+q` with `when: "extStorageDemo.armed"`: the key is dead until the
// context key is set.

// Markdown without a folder: otherwise SCM segments and the tsserver spinner share the status bar. Hence
// `storageUri` on the last frame is `undefined`, as in VS Code.
const sampleFile = resolve(repoRoot, "AGENTS.md");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-ext-storage-demo");

async function runCommand(editor: ScenarioDriver, title: string): Promise<void> {
    await editor.sendKey("F1");
    await editor.waitForNode("#quickInput");
    await editor.sendText(title);
    await editor.sendKey("Enter");
}

/**
 * The barrier is a following ArrowDown and the new `Ln`: input is processed in order; otherwise "nothing happened"
 * would be indistinguishable from "has not happened yet".
 */
async function pressGateKey(editor: ScenarioDriver, line: number): Promise<string> {
    await editor.sendKey("Alt+q");
    await editor.sendKey("ArrowDown");
    const frame = await editor.waitForText((t) => t.includes(`Ln ${String(line)}, Col 1`), { timeoutMs: 5000 });
    return frameToText(frame);
}

export default defineScenario({
    name: "extension-storage",
    title: "Extension storage dirs and the setContext command",
    seedUserData: userData,
    open: [sampleFile],
    cols: 120,
    rows: 24,
    // Extension host scenario: the CI safety net runs it on Linux only.
    skipOn: ["win32"],
    async run(editor) {
        // `run 1` proves globalStorageUri exists and is writable: the counter is
        // read from a file the extension itself put there.
        await editor.waitForText((t) => t.includes("Storage run 1") && t.includes("idle · fired 0"), {
            timeoutMs: 20_000,
        });
        await editor.capture("activated");

        // No context key yet: the extension's keybinding does not resolve and the counter stays put.
        if (!(await pressGateKey(editor, 2)).includes("idle · fired 0")) {
            throw new Error("alt+q fired before setContext — the extension's when clause does not gate the keybinding");
        }
        await editor.capture("not-armed");

        // setContext from the extension sets the key and the same key press comes alive.
        // `armed` in the item text is the extension confirming the call has
        // returned: without it the key press would overtake the RPC.
        await runCommand(editor, "Ext Storage Demo: Arm");
        await editor.waitForText((t) => t.includes("armed · fired 0"), { timeoutMs: 5000 });
        await editor.sendKey("Alt+q");
        await editor.waitForText((t) => t.includes("armed · fired 1"), { timeoutMs: 5000 });
        await editor.capture("armed");

        // And it goes dead again: the key is live state, not a one-shot flag.
        await runCommand(editor, "Ext Storage Demo: Disarm");
        await editor.waitForText((t) => t.includes("idle · fired 1"), { timeoutMs: 5000 });
        if (!(await pressGateKey(editor, 3)).includes("idle · fired 1")) {
            throw new Error("alt+q fired after setContext(false) — the context key was not reset");
        }
        await editor.capture("disarmed");

        // All three paths go to the extension's Output channel. `storageUri` is
        // legitimately absent: this scenario opens no workspace folder.
        await runCommand(editor, "Ext Storage Demo: Show Paths");
        await editor.waitForText((t) => t.includes("globalStorageUri") && t.includes("logUri"), { timeoutMs: 10_000 });
        await editor.capture("paths");
    },
});
