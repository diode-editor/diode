import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { frameLine } from "../helpers/frame.ts";

import { defineScenario, repoRoot, type ScenarioDriver } from "./framework.ts";

// `symbol-highlights` registers `vscode.languages.registerDocumentHighlightProvider` for plaintext, where no
// bundled server competes: writes of `x` in their own color, a read in another, and the object key `x:` left
// alone though the word is the same. It declines any other word: `other` falls back to the textual search.

const sampleDir = mkdtempSync(join(tmpdir(), "diode-document-highlight-"));
const textFile = join(sampleDir, "sample.txt");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-document-highlight");

const LINE = "let x = 1; x = 2; console.log(x); const y = { x: 3 };";
const SOURCE = `${LINE}\nconst other = 1; log(other);\n`;

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
    name: "document-highlight",
    title: "Document highlights: the provider tells writes from reads and skips another symbol of the same name",
    seedUserData: userData,
    open: [sampleDir, textFile],
    cols: 100,
    rows: 16,
    // The extension host subprocess is flaky on Windows.
    skipOn: ["win32"],
    async prepare() {
        writeFileSync(textFile, SOURCE);
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes(LINE));
        await editor.waitForReady();

        // The caret walks off `x` and back until the provider, registered on activation, answers.
        for (let i = 0; i < 4; i++) await editor.sendKey("ArrowRight");
        await editor.waitForText((t) => t.includes("Ln 1, Col 5"));
        await waitFor("the write of x in its own color", async () => {
            // `x = ` twice is a write, `log(x)` a read.
            const [plain, write, secondWrite, read, key] = await backgrounds(editor, "let x", [0, 4, 11, 30, 46]);
            if (read !== plain && write !== plain && write !== read && secondWrite === write && key === plain) {
                return true;
            }
            await editor.sendKey("ArrowDown");
            await editor.sendKey("ArrowUp");
            return false;
        });
        await editor.capture("reads-and-write");

        await editor.sendKey("F7");
        await editor.waitForText((t) => t.includes("Ln 1, Col 12"));
        await editor.capture("f7-walks-the-set");

        // `other` is declined: the textual search lights up both occurrences, in the text color.
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Home");
        for (let i = 0; i < 7; i++) await editor.sendKey("ArrowRight");
        await editor.waitForText((t) => t.includes("Ln 2, Col 8"));
        await waitFor("the textual occurrences of other", async () => {
            const [plain, first, second] = await backgrounds(editor, "const other", [0, 6, 21]);
            return first !== plain && second === first;
        });
        await editor.capture("textual-fallback");
    },
});
