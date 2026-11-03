import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { frameLine } from "../helpers/frame.ts";

import { defineScenario, repoRoot, type ScenarioDriver } from "./framework.ts";

// A snippet session (#1032): `${1:name} = $1;$0` from an extension's `TextEditor.insertSnippet`. Both tab stops are
// highlighted, typing goes into the mirror too, Tab goes to `$0` and ends the session, and the next Tab indents.

const sampleDir = mkdtempSync(join(tmpdir(), "diode-snippet-session-"));
const textFile = join(sampleDir, "sample.txt");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-insert-snippet");

/** The backgrounds of `offsets` in the line starting with `prefix`. */
async function backgrounds(editor: ScenarioDriver, prefix: string, offsets: readonly number[]): Promise<unknown[]> {
    const frame = await editor.captureFrame();
    for (let y = 0; y < frame.rows; y++) {
        const x = frameLine(frame, y).indexOf(prefix);
        if (x >= 0) return offsets.map((offset) => frame.cells[y * frame.cols + x + offset]?.bg);
    }
    throw new Error(`no line with "${prefix}" on the frame`);
}

export default defineScenario({
    name: "snippet-session",
    title: "Snippet session: the tab stops highlighted, typing fills the mirror, Tab to the end",
    seedUserData: userData,
    open: [sampleDir, textFile],
    cols: 80,
    rows: 14,
    // The extension host subprocess is flaky on Windows.
    skipOn: ["win32"],
    userKeybindings: [{ key: "f5", command: "insertSnippetDemo.assign" }],
    async prepare() {
        writeFileSync(textFile, "let \n");
    },
    async run(editor) {
        await editor.waitForText((text) => text.includes("let"));
        await editor.waitForReady();
        await editor.sendKey("End");
        await editor.waitForText((text) => text.includes("Ln 1, Col 5"));

        await editor.sendKey("F5");
        await editor.waitForText((text) => text.includes("let name = name;"));
        // The first tab stop is selected, its mirror carries the tab stop background, the text between has none.
        const [between, mirror] = await backgrounds(editor, "let name = name;", [9, 11]);
        if (between === mirror) throw new Error("the mirror is not highlighted");
        await editor.capture("tab-stops-highlighted");

        await editor.sendText("count");
        await editor.waitForText((text) => text.includes("let count = count;"));
        await editor.capture("mirror-follows-typing");

        await editor.sendKey("Tab");
        await editor.waitForText((text) => text.includes("Ln 1, Col 19"));
        await editor.capture("final-tab-stop");

        await editor.sendKey("Tab");
        await editor.waitForText((text) => text.includes("Ln 1, Col 21"));
        await editor.capture("tab-indents-again");
    },
});
