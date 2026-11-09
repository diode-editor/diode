import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario, type ScenarioDriver } from "./framework.ts";

// Typing in a function body asks the built-in TypeScript for its lenses again, and they come without titles: those
// wait for the resolve. Each row keeps its old title meanwhile, as upstream does; no frame shows an empty row.

const sampleDir = mkdtempSync(join(tmpdir(), "diode-ts-lens-typing-"));
const tsFile = join(sampleDir, "sample.ts");
const settingsDir = join(sampleDir, ".diode");

const TS = `export function foo(a: number) {
  return a + 1;
}

export function bar() {
  return foo(2) + foo(3);
}
`;

/** Past the provide's debounce, its answer and the resolve's debounce: a pause in typing as a person makes it. */
const PAUSE_MS = 1500;

function rowsOf(frame: Awaited<ReturnType<ScenarioDriver["captureFrame"]>>): string[] {
    const rows: string[] = [];
    for (let y = 0; y < frame.rows; y++) {
        rows.push(
            frame.cells
                .slice(y * frame.cols, (y + 1) * frame.cols)
                .map((cell) => cell.char)
                .join(""),
        );
    }
    return rows;
}

/** Every frame for `ms`: both titles must be on each. */
async function watchTitles(editor: ScenarioDriver, ms: number): Promise<void> {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        const text = rowsOf(await editor.captureFrame()).join("\n");
        if (!text.includes("2 references") || !text.includes("0 references")) {
            throw new Error(`a lens row went blank while typing:\n${text}`);
        }
    }
}

export default defineScenario({
    name: "typescript-lens-typing",
    title: "Built-in TypeScript: typing in a function body keeps the reference lenses, no row blinks empty",
    open: [sampleDir, tsFile],
    cols: 90,
    rows: 20,
    // The extension host subprocess is flaky on Windows.
    skipOn: ["win32"],
    async prepare() {
        writeFileSync(tsFile, TS);
        mkdirSync(settingsDir, { recursive: true });
        writeFileSync(
            join(settingsDir, "settings.json"),
            JSON.stringify({
                "typescript.referencesCodeLens.enabled": true,
                "typescript.implementationsCodeLens.enabled": true,
            }),
        );
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("2 references") && t.includes("0 references"), {
            timeoutMs: 60_000,
        });
        await editor.sendKey("ArrowDown");
        await editor.sendKey("End");
        for (const char of [" ", "+", " ", "0"]) {
            await editor.sendText(char);
            await watchTitles(editor, PAUSE_MS);
        }
        await editor.waitForText((t) => t.includes("return a + 1; + 0"));
        await editor.capture("lenses after typing");
    },
});
