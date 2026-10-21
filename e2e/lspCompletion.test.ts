import { createRequire } from "node:module";

import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";
import { waitUntil } from "./helpers/waitFor.ts";

/**
 * Why e2e: the stock client's converter failed silently on every response (the error only
 * went to its outputChannel), and the popup kept showing buffer words — visible only in the frame.
 */

const require_ = createRequire(import.meta.url);

const LSP_SETTINGS = {
    "diode.lsp.typescript.serverPath": require_.resolve("typescript-language-server/lib/cli.mjs"),
    "diode.lsp.typescript.tsserverPath": require_.resolve("typescript/lib/tsserver.js"),
};

const DEFS_TS = 'export function greet(name: string): string {\n    return "hi " + name;\n}\n';
// The type error yields a squiggle — it doubles as the "server is up" readiness signal.
const MAIN_TS = 'import { greet } from "./defs";\n\nconst reply: number = greet("world");\n\nexport { reply };\n';

const UNDERCURL = 8;

describe.skipIf(process.platform === "win32" || process.platform === "darwin")(
    "SEA binary — completion from stock typescript-language-server",
    () => {
        beforeAll(async () => {
            await getBinaryPath();
        }, 300_000);

        it("a dot opens the popup with type members, Ctrl+Space the details pane", { timeout: 240_000 }, async () => {
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

            await waitUntil(
                () => session.captureFrame(),
                (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
                { describe: "undercurl squiggle from tsserver", timeoutMs: 120_000, intervalMs: 500 },
            );

            // Go to the end of the file, start a new line, type `reply.`.
            for (let i = 0; i < 6; i++) await session.key("ArrowDown");
            await session.key("End");
            await session.key("Enter");
            for (const key of ["r", "e", "p", "l", "y", "."]) await session.key(key);

            // The dot is a server trigger character; number members are not in the file, so these are not buffer words.
            await session.waitForText((text) => text.includes("toFixed") && text.includes("toPrecision"), {
                timeoutMs: 120_000,
                intervalMs: 500,
            });

            // Ctrl+Space with the popup open toggles the details panel. The signature
            // arrives in a separate resolve after the list is shown.
            await session.key("Ctrl+Space");
            await session.waitForText((text) => text.includes("(method)") && text.includes("Number.to"), {
                timeoutMs: 60_000,
                intervalMs: 500,
            });

            // The panel is a separate element beside the list, not on top of it.
            const { root } = await session.getDocument();
            const boxes: { type: string; box: { x: number; width: number } }[] = [];
            const walk = (node: { type: string; box: { x: number; width: number }; children?: unknown[] }): void => {
                boxes.push({ type: node.type, box: node.box });
                for (const child of (node.children ?? []) as typeof node[]) walk(child);
            };
            walk(root as unknown as { type: string; box: { x: number; width: number }; children?: unknown[] });

            const details = boxes.find((n) => n.type === "CompletionDetailsElement");
            const list = boxes.find((n) => n.type === "CompletionListElement");
            expect(details?.box.width).toBeGreaterThan(0);
            expect(list?.box.width).toBeGreaterThan(0);
            const [left, right] =
                details!.box.x < list!.box.x ? [details!.box, list!.box] : [list!.box, details!.box];
            expect(left.x + left.width).toBeLessThanOrEqual(right.x);

            // While the list stayed visible, Enter went to `acceptSelectedSuggestion` and silently
            // replaced the typed text with the item. Against a live server: the server itself sets the
            // prefix boundary (range after the dot), and it must not be recomputed.
            for (const key of ["t", "o"]) await session.key(key);
            await session.waitForText((text) => text.includes("reply.to"), { timeoutMs: 60_000 });

            const linesBefore = (await session.node("EditorElement"))?.state?.lineCount;
            await session.key("{");
            await session.waitForText((text) => !text.includes("toPrecision"), { timeoutMs: 60_000 });
            // `{` is a pair from the language configuration: `{}` is inserted, cursor inside.
            await session.waitForText((text) => text.includes("reply.to{}"), { timeoutMs: 60_000 });

            await session.key("Enter");
            // Enter between brackets expands the block: the closing one moves to its own
            // line, the cursor lands on the empty middle line — hence +2 lines, not +1.
            await session.waitForState("EditorElement", (state) => state?.lineCount === (linesBefore as number) + 2, {
                timeoutMs: 60_000,
            });
            const frame = frameToText(await session.captureFrame());
            expect(frame).toContain("reply.to{");
            expect(frame).not.toContain("reply.toFixed");
        });
    },
);
