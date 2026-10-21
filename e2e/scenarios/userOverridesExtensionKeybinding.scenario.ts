import { resolve } from "node:path";

import { frameToText } from "../helpers/frame.ts";

import type { ScenarioDriver } from "./framework.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// A user binding beats an extension binding on the same chord, as in VS Code, even though the extension layer registers
// AFTER keybindings.json.

const sampleFile = resolve(repoRoot, "AGENTS.md");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-ext-storage-demo");

async function runCommand(editor: ScenarioDriver, title: string): Promise<void> {
    await editor.sendKey("F1");
    await editor.waitForNode("#quickInput");
    await editor.sendText(title);
    await editor.sendKey("Enter");
}

export default defineScenario({
    name: "user-overrides-extension-keybinding",
    title: "A user keybinding beats an extension keybinding on the same chord",
    seedUserData: userData,
    userKeybindings: [{ key: "alt+q", command: "workbench.action.quickOpen", args: "AGENTS" }],
    open: [sampleFile],
    cols: 120,
    rows: 24,
    // Extension host scenario: the CI safety net runs on Linux only (like extension-storage).
    skipOn: ["win32"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("idle · fired 0"), { timeoutMs: 20_000 });

        await runCommand(editor, "Ext Storage Demo: Arm");
        await editor.waitForText((t) => t.includes("armed · fired 0"), { timeoutMs: 5000 });
        await editor.capture("both-active");

        await editor.sendKey("Alt+q");
        await editor.waitForNode("#quickInput");
        const frame = frameToText(await editor.waitForText((t) => t.includes("AGENTS.md"), { timeoutMs: 5000 }));
        await editor.capture("user-wins");

        if (!frame.includes("armed · fired 0")) {
            throw new Error("alt+q went to the extension keybinding: the user layer does not beat the extension layer");
        }
    },
});
