import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { dumpFrame, frameToText } from "../helpers/frame.ts";
import { defineScenario, type ScenarioDriver } from "./framework.ts";

// Typing as a person does — short pauses, a burst, a new call that changes the count: every polled frame keeps a
// title on both lens rows (`foo` above, `bar` below); the count of `foo` may change, never blank in between.

const sampleDir = mkdtempSync(join(tmpdir(), "diode-ts-lens-typing-edges-"));
const tsFile = join(sampleDir, "sample.ts");
const settingsDir = join(sampleDir, ".diode");

const TS = `export function foo(a: number) {
  return a + 1;
}

export function bar() {
  return foo(2) + foo(3);
}
`;

/** Polls every frame for `ms`: both rows have a title, `foo`'s matching `fooTitle`. */
async function watch(editor: ScenarioDriver, ms: number, fooTitle: RegExp): Promise<number> {
    const end = Date.now() + ms;
    let frames = 0;
    while (Date.now() < end) {
        const frame = await editor.captureFrame();
        frames++;
        const text = frameToText(frame);
        if (!fooTitle.test(text) || !text.includes("0 references")) {
            throw new Error(`a lens row went blank while typing:\n${dumpFrame(frame)}`);
        }
    }
    return frames;
}

export default defineScenario({
    name: "typescript-lens-typing-edges",
    title: "Built-in TypeScript: short pauses, a burst and a changed count keep every lens row titled",
    open: [sampleDir, tsFile],
    cols: 90,
    rows: 20,
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
        const two = /2 references/;
        await editor.sendKey("ArrowDown");
        await editor.sendKey("End");
        // Short pauses: a provide lands while the resolve of the last one is still out, the edit cancels it.
        for (const char of " + 1 + 2 + 3") {
            await editor.sendText(char);
            await watch(editor, 400, two);
        }
        // A burst, then a long look.
        for (const char of " + 4 + 5") await editor.sendText(char);
        await watch(editor, 3000, two);
        // A third call of foo in bar: the count goes 2 -> 3 with no blank frame in between.
        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("End");
        for (const char of " + foo(4)") {
            await editor.sendText(char);
            await watch(editor, 150, /[23] references/);
        }
        await watch(editor, 4000, /[23] references/);
        await editor.waitForText((t) => t.includes("3 references"), { timeoutMs: 20_000 });
        await editor.capture("lenses after typing");
    },
});
