import { resolve } from "node:path";

import { findTextCell } from "../helpers/frame.ts";

import type { ScenarioDriver } from "./framework.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// Upstream's OPEN EDITORS section of the Explorer: hidden by default, turned on from the "⋯" menu, lists
// the tabs by group with ● on a modified one and × to close. Row text is read from the frame without
// icons: a PUA file icon sits in front of each name.

const sampleDir = resolve(repoRoot, "e2e", "fixtures", "previewTabs");

async function clickText(editor: ScenarioDriver, text: string): Promise<void> {
    const frame = await editor.captureFrame();
    const cell = findTextCell(frame, text);
    if (cell === null) throw new Error(`"${text}" is not in the frame`);
    await editor.click(cell.x + 1, cell.y);
}

/** The section's rows, without icons and padding: "alpha.ts", "Group 1". */
async function rows(editor: ScenarioDriver): Promise<string[]> {
    const list = await editor.waitForNode("#openEditorsList");
    const text = (await editor.waitForText(() => true)).split("\n");
    return text
        .slice(list.box.y, list.box.y + list.box.height)
        .map((line) =>
            line
                .slice(list.box.x, list.box.x + list.box.width)
                .replace(/[-]/gu, "")
                .trim(),
        )
        .filter((line) => line !== "");
}

async function waitForRows(editor: ScenarioDriver, expected: readonly RegExp[]): Promise<void> {
    let seen: string[] = [];
    for (let attempt = 0; attempt < 60; attempt++) {
        seen = await rows(editor);
        if (seen.length === expected.length && expected.every((pattern, i) => pattern.test(seen[i]))) return;
        await new Promise((done) => setTimeout(done, 100));
    }
    throw new Error(`expected rows ${expected.join(", ")}, got [${seen.join(" | ")}]`);
}

export default defineScenario({
    name: "open-editors-view",
    title: "Explorer: the OPEN EDITORS section lists the tabs by group",
    open: [sampleDir],
    cols: 110,
    rows: 26,
    userKeybindings: [
        { key: "ctrl+alt+s", command: "workbench.action.splitEditor" },
        { key: "ctrl+alt+r", command: "workbench.action.reloadWindow" },
    ],
    async run(editor) {
        const tree = await editor.waitForNode("TreeViewElement");
        await editor.waitForText((t) => t.includes("alpha.ts") && t.includes("gamma.ts"));

        // Hidden by default: "⋯" → EXPLORER → Views lists it unchecked.
        await clickText(editor, "⋯");
        await clickText(editor, "EXPLORER");
        await clickText(editor, "Views");
        await editor.waitForText((t) => t.includes("OPEN EDITORS"));
        await editor.capture("views-menu");
        await clickText(editor, "OPEN EDITORS");
        await editor.waitForNode("#openEditorsList");

        // Three files pinned by a double click each: three rows, the active one last.
        const fileTree = await editor.waitForNode("#explorerView");
        for (const index of [0, 1, 2]) {
            const y = fileTree.box.y + index;
            for (let i = 0; i < 2; i++) {
                await editor.sendMouse({ action: "press", button: "left", x: tree.box.x + 5, y });
                await editor.sendMouse({ action: "release", button: "left", x: tree.box.x + 5, y });
            }
        }
        await waitForRows(editor, [/^alpha\.ts$/u, /^beta\.ts$/u, /^gamma\.ts +×$/u]);

        // A modified editor keeps ● on its row while the cursor is elsewhere.
        await editor.sendText("x");
        await clickText(editor, "alpha.ts");
        await waitForRows(editor, [/^alpha\.ts +×$/u, /^beta\.ts$/u, /^gamma\.ts +●$/u]);
        await editor.capture("modified-dot");
        await editor.sendKey("Ctrl+Z");

        // A split adds a group: a "Group N" row above each group's tabs.
        await editor.sendKey("Ctrl+Alt+S");
        await waitForRows(editor, [/^Group 1/u, /^alpha/u, /^beta/u, /^gamma/u, /^Group 2/u, /^alpha/u]);
        await editor.capture("two-groups");

        // A click on beta.ts in Group 1 makes it the active editor of that group.
        await clickText(editor, "beta.ts");
        await waitForRows(editor, [/^Group 1/u, /^alpha/u, /^beta\.ts +×$/u, /^gamma/u, /^Group 2/u, /^alpha/u]);

        // × on its row closes it.
        const list = await editor.waitForNode("#openEditorsList");
        await editor.click(list.box.x + list.box.width - 1, list.box.y + 2);
        await waitForRows(editor, [/^Group 1/u, /^alpha/u, /^gamma/u, /^Group 2/u, /^alpha/u]);
        await editor.capture("closed");

        // The section stays on after a window reload.
        // The reloading window takes its socket along: the key gets no answer (docs/TESTING.md).
        await editor.sendKey("Ctrl+Alt+R").catch(() => undefined);
        await editor.reconnect();
        await editor.waitForNode("#openEditorsList");
        await editor.waitForText((t) => t.includes("OPEN EDITORS"));
        await editor.capture("after-reload");
    },
});
