import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { frameLine } from "../helpers/frame.ts";

import { defineScenario, repoRoot, type ScenarioDriver } from "./framework.ts";

// `linked-tags` registers `vscode.languages.registerLinkedEditingRangeProvider` for plaintext, where no bundled
// server competes, and the fixture turns `editor.linkedEditing` on: the name in the opening tag drives the closing one.

const sampleDir = mkdtempSync(join(tmpdir(), "diode-linked-editing-"));
const textFile = join(sampleDir, "sample.txt");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-linked-editing");

const SOURCE = "<div></div>\n";

/** The backgrounds of `offsets` in the line starting with `prefix`. */
async function backgrounds(editor: ScenarioDriver, prefix: string, offsets: readonly number[]): Promise<unknown[]> {
    const frame = await editor.captureFrame();
    for (let y = 0; y < frame.rows; y++) {
        const x = frameLine(frame, y).indexOf(prefix);
        if (x >= 0) return offsets.map((offset) => frame.cells[y * frame.cols + x + offset]?.bg);
    }
    throw new Error(`no line with "${prefix}" on the frame`);
}

async function waitFor(what: string, condition: () => Promise<boolean>): Promise<void> {
    const deadline = Date.now() + 20_000;
    while (!(await condition())) {
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
        await new Promise((r) => setTimeout(r, 50));
    }
}

export default defineScenario({
    name: "linked-editing",
    title: "Linked editing: typing in the opening tag rewrites the closing one, one undo takes both back",
    seedUserData: userData,
    open: [sampleDir, textFile],
    cols: 80,
    rows: 14,
    // The extension host subprocess is flaky on Windows.
    skipOn: ["win32"],
    async prepare() {
        writeFileSync(textFile, SOURCE);
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("<div></div>"));
        await editor.waitForReady();

        // The caret walks off the name and back until the provider, registered on activation, answers.
        await editor.sendKey("ArrowRight");
        await editor.sendKey("ArrowRight");
        await editor.waitForText((t) => t.includes("Ln 1, Col 3"));
        await waitFor("the linked ranges", async () => {
            const [plain, open, close] = await backgrounds(editor, "<div>", [0, 1, 7]);
            if (open !== plain && close === open) return true;
            await editor.sendKey("ArrowRight");
            await editor.sendKey("ArrowLeft");
            return false;
        });
        await editor.capture("linked-ranges");

        await editor.type("x");
        await editor.waitForText((t) => t.includes("<dxiv></dxiv>"));
        await editor.capture("both-tags-rewritten");

        await editor.sendKey("Ctrl+Z");
        await editor.waitForText((t) => t.includes("<div></div>"));
        await editor.capture("one-undo-takes-both-back");

        // Escape breaks the link: the input stays in its tag.
        await waitFor("the link again", async () => {
            const [plain, open] = await backgrounds(editor, "<div>", [0, 1]);
            return open !== plain;
        });
        await editor.sendKey("Escape");
        await waitFor("the ranges to go", async () => {
            const [plain, open] = await backgrounds(editor, "<div>", [0, 1]);
            return open === plain;
        });
        await editor.type("y");
        await editor.waitForText((t) => t.includes("<dyiv></div>"));
        await editor.capture("escape-breaks-the-link");
    },
});
