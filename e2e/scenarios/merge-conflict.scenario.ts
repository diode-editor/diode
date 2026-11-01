import { resolve } from "node:path";

import { findTextCell } from "../helpers/frame.ts";

import { defineScenario, repoRoot, type ScenarioDriver } from "./framework.ts";

// Stock Merge Conflict from the marketplace: lenses above each conflict, a jump to the next one, Compare in a diff
// tab, a click on Accept Incoming resolves one conflict and a single undo brings it back.

const conflictFile = resolve(repoRoot, "e2e", "fixtures", "mergeConflictSample", "conflict.txt");

async function palette(editor: ScenarioDriver, title: string): Promise<void> {
    await editor.sendKey("F1");
    await editor.waitForNode("#quickInput");
    await editor.sendText(title);
    await editor.waitForText((t) => t.includes(title), { timeoutMs: 20_000 });
    await editor.sendKey("Enter");
}

export default defineScenario({
    name: "merge-conflict",
    title: "Merge Conflict from the marketplace: lenses, next conflict, compare, accept incoming, undo",
    open: [conflictFile],
    installVsix: ["vscode.merge-conflict"],
    network: true,
    cols: 130,
    rows: 24,
    // Extension host scenarios run a subprocess — Linux only.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        const frame = await editor.waitForText((t) => t.includes("Accept Incoming Change"), { timeoutMs: 40_000 });
        await editor.capture("lenses");
        const lens = findTextCell(frame, "Accept Incoming Change");
        if (lens === null) throw new Error("the lens is not on screen");

        await palette(editor, "Merge Conflict: Next Conflict");
        await editor.waitForText((t) => t.includes("Ln 2, Col 1"));
        await editor.capture("next-conflict");

        await palette(editor, "Merge Conflict: Compare Current Conflict");
        await editor.waitForText((t) => t.includes("ours one") && t.includes("theirs one") && t.includes("↔"));
        await editor.capture("compare");
        await palette(editor, "Close Active Editor");
        await editor.waitForText((t) => !t.includes("↔"));

        await editor.click(lens.x, lens.y);
        await editor.waitForText((t) => t.includes("theirs one") && !t.includes("ours one"));
        await editor.capture("accepted-incoming");

        await editor.sendKey("Ctrl+z");
        await editor.waitForText((t) => t.includes("ours one") && t.includes("theirs one"));
        await editor.capture("undone");
    },
});
