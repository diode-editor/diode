import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// User keybindings on the commands an extension would call: the cursor moves in the frame on every form of quick
// input, and the answer reaches the extension. One binding has a `when`, as people write them, the other has none.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-quick-input-probe");

export default defineScenario({
    name: "quick-input-commands",
    title: "Quick input commands from user keybindings (quickOpenSelectNext, accept, close)",
    seedUserData: userData,
    open: [repoRoot, sampleFile],
    userKeybindings: [
        { key: "f6", command: "workbench.action.quickOpenSelectNext", when: "inQuickOpen" },
        { key: "f7", command: "workbench.action.acceptSelectedQuickOpenItem" },
        { key: "f8", command: "workbench.action.closeQuickOpen" },
        { key: "f9", command: "workbench.action.quickPickManyToggle" },
    ],
    cols: 100,
    rows: 30,
    // Linux only: the extension host subprocess is flaky on Windows.
    skipOn: ["win32"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("Diode Probe"), { timeoutMs: 30000 });
        const probe = async (title: string): Promise<void> => {
            await editor.sendKey("F1");
            await editor.waitForNode("#quickInput");
            await editor.sendText(title);
            await editor.sendKey("Enter");
        };

        await probe("Pick Fruit");
        await editor.waitForText((t) => t.includes("Pick a fruit") && t.includes("cherry"), { timeoutMs: 20000 });
        await editor.capture("quick-pick-open");
        await editor.sendKey("F6");
        await editor.capture("quick-pick-next");
        await editor.sendKey("F7");
        await editor.waitForText((t) => t.includes("Fruit: banana"), { timeoutMs: 20000 });

        await probe("Pick Many (preselected)");
        await editor.waitForText((t) => t.includes("[✓] beta"), { timeoutMs: 20000 });
        await editor.sendKey("F6");
        await editor.sendKey("F9");
        await editor.waitForText((t) => t.includes("[✓] alpha"));
        await editor.capture("multi-select-toggled");
        await editor.sendKey("F7");
        await editor.waitForText((t) => t.includes("Picked: alpha, beta"), { timeoutMs: 20000 });

        await probe("Ask Name (prefilled)");
        await editor.waitForText((t) => t.includes("How should we address you"), { timeoutMs: 20000 });
        await editor.capture("input-box");
        await editor.sendKey("F8");
        await editor.waitForText((t) => t.includes("Ask Name: cancelled"), { timeoutMs: 20000 });
        await editor.capture("input-box-closed");

        await probe("Open File Dialog");
        await editor.waitForText((t) => t.includes("Pick a file") && t.includes(".github"), { timeoutMs: 20000 });
        await editor.sendKey("F6");
        await editor.capture("file-dialog-next");
        await editor.sendKey("F8");
    },
});
