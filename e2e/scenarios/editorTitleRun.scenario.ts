import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { findTextCell, frameLine } from "../helpers/frame.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// `editor/title/run`, as Python, Java, Code Runner and JBang contribute it: one ▷ button with an attached ▾ in
// the editor title. The fixture's items have PNG icons (like JBang), so the button shows the submenu's run glyph.
// The arrow lists both items; picking Debug runs it and makes it the button's action, so the next ▷ runs Debug.

const sampleDir = mkdtempSync(join(tmpdir(), "diode-editor-title-run-"));
const sampleFile = join(sampleDir, "hello.demo.txt");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-run-button");
// Row 1 is the tabs' top line, row 2 the tab labels and the title buttons.
const TAB_ROW = 2;
const ARROW = "▾";
const tabRow = (text: string): string => text.split("\n")[TAB_ROW] ?? "";

export default defineScenario({
    name: "editor-title-run",
    title: "Run or Debug split button in the editor title: the arrow lists the items, the button runs the last picked",
    seedUserData: userData,
    open: [sampleDir, sampleFile],
    cols: 80,
    rows: 16,
    // The extension host subprocess is flaky on Windows.
    skipOn: ["win32"],
    async prepare() {
        writeFileSync(sampleFile, "print('hello')\n");
    },
    async run(editor) {
        const shown = await editor.waitForText((t) => tabRow(t).includes(ARROW), { timeoutMs: 20_000 });
        const row = frameLine(shown, TAB_ROW);
        const arrowX = row.indexOf(ARROW);
        // The button sits right before the arrow: ` ▷ ▾ `.
        const buttonX = arrowX - 2;
        await editor.capture("button");

        await editor.click(arrowX, TAB_ROW);
        await editor.waitForText((t) => t.includes("Run Demo") && t.includes("Debug Demo"));
        await editor.capture("dropdown");

        const debugItem = findTextCell(await editor.captureFrame(), "Debug Demo");
        if (debugItem === null) throw new Error("Debug Demo is not in the dropdown");
        await editor.click(debugItem.x, debugItem.y);
        await editor.waitForText((t) => t.includes("run-demo: Debug #1"));

        await editor.click(buttonX, TAB_ROW);
        await editor.waitForText((t) => t.includes("run-demo: Debug #2"));
        await editor.capture("button-runs-last-picked");
    },
});
