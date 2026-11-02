import { createRequire } from "node:module";

import { beforeAll, describe, it } from "vitest";

import type { HeadlessApp } from "./helpers/appSession.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";
import { waitUntil } from "./helpers/waitFor.ts";

const require_ = createRequire(import.meta.url);

const LSP_SETTINGS = {
    "diode.lsp.typescript.serverPath": require_.resolve("typescript-language-server/lib/cli.mjs"),
    "diode.lsp.typescript.tsserverPath": require_.resolve("typescript/lib/tsserver.js"),
};

/** Enough symbols to fill the picker's ten rows, then one in the middle of a long file. */
function longFile(): string {
    const methods = Array.from({ length: 12 }, (_, i) => `    method${i}(): number {\n        return ${i};\n    }\n`).join("");
    const filler = Array.from({ length: 40 }, (_, i) => `// before ${i}\n`).join("");
    const after = Array.from({ length: 200 }, (_, i) => `// after ${i}\n`).join("");
    return `export class First {\n${methods}}\n\n${filler}export const target = 1;\n${after}`;
}

const FOLDED_FILE =
    "export class Folded {\n    inside(): number {\n        return 1;\n    }\n}\n\nexport const other = 2;\n";

async function openSymbols(app: HeadlessApp): Promise<void> {
    const { session } = app;
    await session.key("Ctrl+Shift+o");
    await session.waitForText((text) => text.includes("symbols ("), { timeoutMs: 120_000, intervalMs: 250 });
}

// Linux only: extension host + language server spawn (docs/TODO/E2E.md).
describe.skipIf(process.platform === "win32" || process.platform === "darwin")("Go to Symbol: what the user sees", () => {
    beforeAll(async () => {
        await getBinaryPath();
    }, 300_000);

    it("moving down the full list keeps the previewed line visible at 100x24", { timeout: 240_000 }, async () => {
        const app = await useHeadlessApp({
            files: { "tsconfig.json": "{}", "long.ts": longFile() },
            settings: LSP_SETTINGS,
            open: ["long.ts"],
            cols: 100,
            rows: 24,
        });
        const { session } = app;
        await session.waitForText((text) => text.includes("export class First"));
        await openSymbols(app);

        // Twelve methods and the class come first; thirteen steps land on `target`.
        for (let i = 0; i < 13; i++) await session.key("ArrowDown");
        await session.waitForState("#quickInput", (state) => state["activeIndex"] === 13);

        await session.waitForText((text) => text.includes("export const target = 1"), { timeoutMs: 5_000 });
    });

    it("Escape after previewing into a folded class leaves it folded", { timeout: 240_000 }, async () => {
        const app = await useHeadlessApp({
            files: { "tsconfig.json": "{}", "folded.ts": FOLDED_FILE },
            settings: LSP_SETTINGS,
            open: ["folded.ts"],
            cols: 100,
            rows: 40,
        });
        const { session } = app;
        await session.waitForText((text) => text.includes("export class Folded"));
        // Fold regions are computed after a delay; until then the command has nothing to fold.
        await waitUntil(
            async () => {
                await session.executeCommand("editor.fold");
                return frameToText(await session.captureFrame());
            },
            (text) => !text.includes("inside(): number"),
            { timeoutMs: 30_000, intervalMs: 250, describe: "the class folded" },
        );

        await openSymbols(app);
        await session.text("inside");
        await session.waitForText((text) => text.includes("symbols (1)"));
        await session.key("Escape");
        await session.waitForNoNode("#quickInput");

        await session.waitForText((text) => text.includes("export class Folded") && !text.includes("inside(): number"), {
            timeoutMs: 5_000,
        });
    });
});
