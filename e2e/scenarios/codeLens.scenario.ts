import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { defineScenario, repoRoot, type ScenarioDriver } from "./framework.ts";

// `demo-code-lens` registers `vscode.languages.registerCodeLensProvider` for typescript. Over each function:
// `2 references` (shown by `editor.action.showReferences`) and `Run`, which comes from the resolve and whose command
// runs in the extension with its real `vscode.Position`. The setting removes the rows.

const sampleDir = mkdtempSync(join(tmpdir(), "diode-code-lens-"));
const tsFile = join(sampleDir, "sample.ts");
const settingsDir = join(sampleDir, ".diode");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-code-lens");

const TS = `function alpha() {}
function bravo() {}
`;

const ROW = "2 references | Run";

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
    name: "code-lens",
    title: "Extension code lens: rows over functions, a click runs the extension's command, references open the view",
    seedUserData: userData,
    open: [sampleDir, tsFile],
    cols: 90,
    rows: 20,
    // The extension host subprocess is flaky on Windows.
    skipOn: ["win32"],
    // J: F/E/S/V/G/H are menu bar mnemonics and O is the SS3 prefix.
    userKeybindings: [{ key: "alt+j", command: "codelens.showLensesInCurrentLine" }],
    async prepare() {
        writeFileSync(tsFile, TS);
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes(ROW), { timeoutMs: 20_000 });
        await editor.capture("rows");

        await clickTitle(editor, "Run");
        await editor.waitForText((t) => t.includes("// ran with a Position"));
        await editor.capture("the command ran in the extension");

        await editor.waitForReady();
        await editor.sendKey("Alt+j");
        await editor.waitForText((t) => t.includes("Select a command"));
        await editor.capture("the lenses of the line");
        await editor.sendKey("Escape");
        await editor.waitForText((t) => !t.includes("Select a command"));

        // The edit brought a new answer: its `Run` comes after the resolve debounce.
        await editor.waitForText((t) => t.includes(ROW));
        await clickTitle(editor, "2 references");
        await editor.waitForText((t) => t.includes("Locations"));
        await editor.capture("the references view");

        mkdirSync(settingsDir, { recursive: true });
        writeFileSync(join(settingsDir, "settings.json"), JSON.stringify({ "editor.codeLens": false }));
        await editor.waitForText((t) => !t.includes("2 references"));
        await editor.capture("the setting removes the rows");
    },
});
