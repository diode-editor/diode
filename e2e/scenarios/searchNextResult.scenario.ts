import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// One file: ripgrep reports the matches of a file in line order, so the walk is deterministic.
const sampleDir = resolve(repoRoot, "e2e", "fixtures", "searchNavigation");

async function typeText(driver: { sendKey(name: string): Promise<void> }, text: string): Promise<void> {
    for (const ch of text) {
        await driver.sendKey(ch);
    }
}

export default defineScenario({
    name: "searchNextResult",
    title: "Search: F4/Shift+F4 walk the results from the editor, wrapping at the end",
    open: [sampleDir],
    cols: 100,
    rows: 24,
    // The e2e key-DSL can't encode Ctrl+Shift+F.
    userKeybindings: [{ key: "f6", command: "workbench.view.search" }],
    async run(driver) {
        await driver.waitForText((t) => t.includes("EXPLORER"));

        await driver.sendKey("F6");
        await driver.waitForText((t) => t.includes("SEARCH"));
        await typeText(driver, "needle");
        await driver.waitForText((t) => t.includes("3 results in 1 file"));

        // F4 opens the first match in the editor; the next ones are walked from the editor.
        await driver.sendKey("F4");
        await driver.waitForText((t) => t.includes("Ln 1, Col 7"));
        await driver.sendKey("F4");
        await driver.waitForText((t) => t.includes("Ln 3, Col 1"));
        await driver.capture("second-match");

        await driver.sendKey("F4");
        await driver.waitForText((t) => t.includes("Ln 5, Col 7"));
        await driver.sendKey("F4");
        await driver.waitForText((t) => t.includes("Ln 1, Col 7"));
        await driver.capture("wrapped");

        await driver.sendKey("Shift+F4");
        await driver.waitForText((t) => t.includes("Ln 5, Col 7"));
        await driver.capture("previous");
    },
});
