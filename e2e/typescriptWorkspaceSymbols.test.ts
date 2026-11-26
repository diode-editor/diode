import { createRequire } from "node:module";

import { beforeAll, describe, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";
import { waitUntil } from "./helpers/waitFor.ts";

/**
 * Why e2e: the row comes from the stock server through the language client, the provider seam and the Quick Open
 * picker, and Enter ends in another file. Only the frame shows that whole chain.
 */

const require_ = createRequire(import.meta.url);

const LSP_SETTINGS = {
    "diode.lsp.typescript.serverPath": require_.resolve("typescript-language-server/lib/cli.mjs"),
    "diode.lsp.typescript.tsserverPath": require_.resolve("typescript/lib/tsserver.js"),
};

const DEFS_TS = 'export function greet(name: string): string {\n    return "hi " + name;\n}\n';
// The type error yields a squiggle: the signal that the server has loaded the project.
const MAIN_TS = 'import { greet } from "./defs";\n\nconst reply: number = greet("world");\n\nexport { reply };\n';

const UNDERCURL = 8;

describe.skipIf(process.platform === "win32" || process.platform === "darwin")(
    "SEA binary — # in Quick Open with the stock typescript-language-server",
    () => {
        beforeAll(async () => {
            await getBinaryPath();
        }, 300_000);

        it("# finds a function of another file and Enter opens that file", { timeout: 240_000 }, async () => {
            const { session } = await useHeadlessApp({
                files: {
                    "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }),
                    "defs.ts": DEFS_TS,
                    "main.ts": MAIN_TS,
                },
                settings: LSP_SETTINGS,
                open: [".", "main.ts"],
            });
            await session.waitForNode("EditorElement");
            await waitUntil(
                () => session.captureFrame(),
                (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
                { describe: "undercurl squiggle from tsserver", timeoutMs: 120_000, intervalMs: 500 },
            );

            await session.key("Ctrl+P");
            await session.waitForNode("#quickInput");
            for (const char of "#greet") await session.key(char);

            // A picker row: the name, then its file. The Explorer also lists defs.ts, but to the left of the editor's text.
            await session.waitForText((text) => /greet.*defs\.ts/.test(text), {
                timeoutMs: 30_000,
                intervalMs: 500,
            });

            await session.key("Enter");
            await session.waitForText((text) => text.includes("export function greet"), {
                timeoutMs: 30_000,
                intervalMs: 500,
            });
        });
    },
);
