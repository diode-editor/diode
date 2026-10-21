import { createRequire } from "node:module";

import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";
import { waitUntil } from "./helpers/waitFor.ts";

/** Assertions wait for text that is NOT in the buffer: the "weak assertion" pitfall (docs/TODO/Suggest.md). */

const require_ = createRequire(import.meta.url);
const SERVER_CLI = require_.resolve("typescript-language-server/lib/cli.mjs");
const TSSERVER_JS = require_.resolve("typescript/lib/tsserver.js");

const LSP_SETTINGS = {
    "diode.lsp.typescript.serverPath": SERVER_CLI,
    "diode.lsp.typescript.tsserverPath": TSSERVER_JS,
};

const DEFS_TS = "export function greet(name: string, age: number): string {\n    return name + String(age);\n}\n";
// Type error on the last line, for the squiggle (readiness).
const MAIN_TS = 'import { greet } from "./defs";\n\nconst reply: number = 1;\n';

const UNDERCURL = 8;
const SIGNATURE = "greet(name: string, age: number): string";

// Linux only: extension host + language server spawn (docs/TODO/E2E.md).
describe.skipIf(process.platform === "win32" || process.platform === "darwin")(
    "SEA binary — parameter hints from the stock typescript-language-server",
    () => {
        beforeAll(async () => {
            await getBinaryPath();
        }, 300_000);

        it("'(' opens parameter hints, a comma advances the parameter, Escape closes them", { timeout: 240_000 }, async () => {
            const { session } = await useHeadlessApp({
                files: {
                    "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }),
                    "defs.ts": DEFS_TS,
                    "main.ts": MAIN_TS,
                },
                settings: LSP_SETTINGS,
                open: ["main.ts"],
            });
            await session.waitForNode("EditorElement");

            // A squiggle from tsserver is the readiness signal that the server indexed the project.
            await waitUntil(
                () => session.captureFrame(),
                (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
                { describe: "undercurl squiggle from tsserver", timeoutMs: 120_000, intervalMs: 500 },
            );

            await session.key("Ctrl+End");
            // Via key presses: the hint is opened by TYPING a trigger character (onDidType), while a paste,
            // even of one character, deliberately doesn't open it, as in VS Code. `session.text` is a paste.
            for (const char of "greet(") await session.key(char);

            await session.waitForText((text) => text.includes(SIGNATURE), {
                timeoutMs: 60_000,
                intervalMs: 500,
            });

            for (const char of '"world",') await session.key(char);
            await waitUntil(
                () => session.captureFrame(),
                (frame) => frameToText(frame).includes(SIGNATURE),
                { describe: "parameter hints survive the comma", timeoutMs: 30_000, intervalMs: 250 },
            );

            // Typing `world` may also open completion, and Escape belongs to it while it's shown
            // (as in VS Code); then the next Escape closes the hint.
            let frame = await session.captureFrame();
            for (let attempt = 0; attempt < 3 && frameToText(frame).includes(SIGNATURE); attempt++) {
                await session.key("Escape");
                frame = await session.captureFrame();
            }
            expect(frameToText(frame)).not.toContain(SIGNATURE);
            expect(frameToText(frame)).toContain('greet("world",');
        });
    },
);
