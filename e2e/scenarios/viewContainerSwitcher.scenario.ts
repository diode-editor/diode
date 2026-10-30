import { resolve } from "node:path";

import { ACTIVATION_LOG_KEYBINDINGS, openActivationLog, waitForActivationLine } from "../helpers/activationLog.ts";
import { findTextCell } from "../helpers/frame.ts";

import { explorerTitle } from "../helpers/explorerTitle.ts";
import { defineScenario, repoRoot, type ScenarioDriver } from "./framework.ts";

// The container switcher — our activity bar: a click on the sidebar title lists the sidebar containers,
// built-in ones and an extension's `viewsContainers.activitybar` entry alike. Picking "Build Tools" shows the
// extension's tree sections (empty until the extension registers its trees) and starts the extension by `onView:`.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-view-container");

async function clickText(editor: ScenarioDriver, needle: string): Promise<void> {
    const frame = await editor.waitForText((t) => t.includes(needle));
    const cell = findTextCell(frame, needle);
    if (cell === null) throw new Error(`"${needle}" is not on screen`);
    await editor.click(cell.x, cell.y);
}

export default defineScenario({
    name: "view-container-switcher",
    title: "Container switcher on the sidebar title: built-in and extension containers, onView activation",
    seedUserData: userData,
    open: [repoRoot, sampleFile],
    cols: 120,
    rows: 32,
    // Extension host scenario: the CI safety net runs on Linux only (like extension-tree-view).
    skipOn: ["win32"],
    userKeybindings: ACTIVATION_LOG_KEYBINDINGS,
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));
        await editor.waitForReady();

        await clickText(editor, explorerTitle(repoRoot));
        await editor.waitForText((t) => t.includes("Source Control") && t.includes("Build Tools"));
        await editor.capture("switcher");

        await clickText(editor, "Build Tools");
        await editor.waitForText(
            (t) => t.includes("BUILD TOOLS") && t.includes("RUN TARGETS") && t.includes("BUILD HISTORY"),
        );
        await editor.capture("extension-container");

        await openActivationLog(editor);
        await waitForActivationLine(editor, 'activated extension "test.build-tools" (onView:buildTools.targets)');
        await editor.capture("activated-on-view");
    },
});
