import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario, type ScenarioDriver } from "./framework.ts";

// The built-in TypeScript with upstream's settings on: parameter names and variable types in the text, the references
// lens over the function. A click on the lens opens the references view with the two calls.

const sampleDir = mkdtempSync(join(tmpdir(), "diode-ts-lens-hints-"));
const tsFile = join(sampleDir, "sample.ts");
const settingsDir = join(sampleDir, ".diode");

const TS = `export function add(left: number, right: number) {
    return left + right;
}
const one = add(1, 2);
const two = add(one, 4);
export { two };
`;

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
    name: "typescript-lens-hints",
    title: "Built-in TypeScript: inlay hints and the references lens by upstream's settings, a click opens the view",
    open: [sampleDir, tsFile],
    cols: 90,
    rows: 22,
    // The extension host subprocess is flaky on Windows.
    skipOn: ["win32"],
    async prepare() {
        writeFileSync(tsFile, TS);
        mkdirSync(settingsDir, { recursive: true });
        writeFileSync(
            join(settingsDir, "settings.json"),
            JSON.stringify({
                "typescript.inlayHints.parameterNames.enabled": "all",
                "typescript.inlayHints.variableTypes.enabled": true,
                "typescript.referencesCodeLens.enabled": true,
            }),
        );
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("const one : number = add(left: 1, right: 2);"), {
            timeoutMs: 60_000,
        });
        await editor.waitForText((t) => t.includes("2 references"), { timeoutMs: 60_000 });
        await editor.capture("hints and the lens");

        await clickTitle(editor, "2 references");
        await editor.waitForText((t) => t.includes("Locations"));
        await editor.capture("the references view");
    },
});
