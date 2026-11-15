import { resolve } from "node:path";

import type { ScenarioDriver } from "./framework.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// The terminal-profile-demo extension declares a profile in `contributes.terminal.profiles` and registers its
// provider on activation; it shows `profile:activated` in the status bar once it runs.

const sampleFile = resolve(repoRoot, "AGENTS.md");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-terminal-profile");

async function runCommand(editor: ScenarioDriver, title: string): Promise<void> {
    await editor.sendKey("F1");
    await editor.waitForNode("#quickInput");
    await editor.sendText(title);
    await editor.waitForText((t) => t.includes(title));
    await editor.sendKey("Enter");
}

export default defineScenario({
    name: "extension-terminal-profile",
    title: "Extension terminal profiles: Create New Terminal (With Profile) offers and opens a contributed profile",
    seedUserData: userData,
    open: [sampleFile],
    cols: 120,
    rows: 30,
    async run(editor) {
        await editor.waitForText((t) => t.includes("Ln 1"), { timeoutMs: 20_000 });

        await runCommand(editor, "Terminal: Create New Terminal (With Profile)");
        await editor.waitForText(
            (t) => t.includes("Select the terminal profile to create") && t.includes("Echo Profile Terminal"),
        );
        // Listed from the manifest alone: the extension has not started yet.
        await editor.waitForText((t) => t.includes("contributed") && !t.includes("profile:activated"));
        await editor.capture("picker");

        await editor.sendText("Echo");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("hello from the profile terminal") && t.includes("profile:activated"), {
            timeoutMs: 15_000,
        });
        await editor.sendText("typed");
        await editor.waitForText((t) => t.includes("typed"));
        await editor.capture("profile-terminal");
    },
});
