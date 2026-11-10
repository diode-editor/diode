import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { defineScenario, repoRoot, type ScenarioDriver } from "./framework.ts";

// `demo-code-lens`: `Run` comes from the resolve and appends `// ran with a Position` to the file. Each run is an edit,
// so the next answer comes and the row keeps its old title until that answer's resolve (#1097). A title on screen is
// a promise: clicking it then, as a person does right after the line appeared, must run the command every time.

const sampleDir = mkdtempSync(join(tmpdir(), "diode-code-lens-held-"));
const tsFile = join(sampleDir, "sample.ts");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-code-lens");

const TS = `function alpha() {}
`;

const RAN = "// ran with a Position";

function count(text: string): number {
    return text.split(RAN).length - 1;
}

async function clickTitle(editor: ScenarioDriver, title: string): Promise<void> {
    const frame = await editor.captureFrame();
    for (let y = 0; y < frame.rows; y++) {
        const line = frame.cells
            .slice(y * frame.cols, (y + 1) * frame.cols)
            .map((cell) => cell.char)
            .join("");
        const x = line.indexOf(title);
        if (x >= 0) {
            await editor.click(x, y);
            return;
        }
    }
    throw new Error(`"${title}" is not on screen`);
}

export default defineScenario({
    name: "code-lens-held-click",
    title: "Extension code lens: a click on a title kept over a new answer runs its command",
    seedUserData: userData,
    open: [sampleDir, tsFile],
    cols: 90,
    rows: 20,
    // The extension host subprocess is flaky on Windows.
    skipOn: ["win32"],
    async prepare() {
        writeFileSync(tsFile, TS);
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("2 references | Run"), { timeoutMs: 20_000 });
        // Clicked as soon as the line of the last run shows, and a bit later: before the new answer, while it is held.
        for (const [ran, delayMs] of [
            [0, 0],
            [1, 0],
            [2, 300],
            [3, 150],
        ] as const) {
            await editor.waitForText((t) => count(t) === ran && t.includes("2 references | Run"));
            await new Promise((r) => setTimeout(r, delayMs));
            // A person clicks the title when it is there; a row that blinked empty is waited out.
            await editor.waitForText((t) => t.includes("2 references | Run"));
            await clickTitle(editor, "Run");
            await editor.waitForText((t) => count(t) === ran + 1, { timeoutMs: 5_000 });
        }
        await editor.capture("every click ran");
    },
});
