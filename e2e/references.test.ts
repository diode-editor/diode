import { createRequire } from "node:module";

import type { GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";

import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";
import { waitUntil } from "./helpers/waitFor.ts";

/**
 * Why e2e: code lines missing from the open buffer are fetched by our preview layer, which
 * reads the other file — unit tests do not see the server → preview → list row → frame chain.
 */

const require_ = createRequire(import.meta.url);

const LSP_SETTINGS = {
    "diode.lsp.typescript.serverPath": require_.resolve("typescript-language-server/lib/cli.mjs"),
    "diode.lsp.typescript.tsserverPath": require_.resolve("typescript/lib/tsserver.js"),
};

const DEFS_TS = 'export function greet(name: string): string {\n    return "hi " + name;\n}\n';
// The type error yields a squiggle — which doubles as the "server is up" readiness signal.
const MAIN_TS = 'import { greet } from "./defs";\n\nconst reply: number = greet("world");\n\nexport { reply };\n';

const UNDERCURL = 8;

/** Whether the predicate holds on a frame within the next couple of seconds (without failing on timeout). */
async function holdsSoon(
    session: { captureFrame(): Promise<GridSnapshot> },
    predicate: (text: string) => boolean,
): Promise<boolean> {
    for (let i = 0; i < 20; i++) {
        if (predicate(frameToText(await session.captureFrame()))) return true;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
}

describe.skipIf(process.platform === "win32" || process.platform === "darwin")(
    "SEA binary — Find All References from the stock typescript-language-server",
    () => {
        beforeAll(async () => {
            await getBinaryPath();
        }, 300_000);

        it("the panel collects references from two files, Enter and F4 navigate them", { timeout: 240_000 }, async () => {
            const { session } = await useHeadlessApp({
                files: {
                    "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }),
                    "defs.ts": DEFS_TS,
                    "main.ts": MAIN_TS,
                },
                settings: LSP_SETTINGS,
                // Sidebar viewlets (REFERENCES included) are built on workspaceFolder — without a folder
                // there is no panel at all.
                open: [".", "main.ts"],
            });
            await session.waitForNode("EditorElement");

            await waitUntil(
                () => session.captureFrame(),
                (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
                { describe: "undercurl squiggle from tsserver", timeoutMs: 120_000, intervalMs: 500 },
            );

            // Put the cursor on the `greet` call (line 3, column 23) and run Find All References.
            await session.key("ArrowDown");
            await session.key("ArrowDown");
            for (let i = 0; i < 23; i++) await session.key("ArrowRight");
            await session.key("Ctrl+K");
            await session.key("Ctrl+R");

            await session.waitForText(
                // `export function greet` exists only in defs.ts.
                (text) => text.includes("REFERENCES") && text.includes("results in 2") && text.includes("export function greet"),
                { timeoutMs: 120_000, intervalMs: 500 },
            );

            // The server decides the reference order, and the "first" one is not necessarily the declaration: step
            // with F4 until we land in defs.ts. What matters is that navigation takes the editor to ANOTHER file.
            let reachedDefs = false;
            for (let step = 0; step < 4 && !reachedDefs; step++) {
                await session.key(step === 0 ? "Enter" : "F4");
                reachedDefs = await holdsSoon(session, (text) => text.includes('return "hi " + name'));
            }
            expect(reachedDefs, "walking the references did not reach defs.ts").toBe(true);

            // The panel stays after navigation: the result lives until the next search.
            const frame = frameToText(await session.captureFrame());
            expect(frame).toContain("REFERENCES");
        });
    },
);
