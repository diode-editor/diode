import { beforeAll, describe, expect, it } from "vitest";

import { MARKETPLACE_OFFLINE } from "../src/TestUtils/marketplaceEnv.ts";
import { MESSY_JSON, MESSY_MD, PRETTIER_ID } from "../src/TestUtils/prettierFixture.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

/**
 * The suite also gates loading ESM extensions in the built binary: prettier since 12.x is
 * `"type": "module"`, and under SEA a direct `import()` from the embedded main is intercepted
 * by the embedder hook. A unit test cannot check this.
 */

// Linux only: extension host (docs/TODO/E2E.md).
describe.skipIf(process.platform === "win32" || process.platform === "darwin" || MARKETPLACE_OFFLINE)(
    "SEA binary — stock prettier.vsix (markdown and json formatting)",
    () => {
        beforeAll(async () => {
            await getBinaryPath();
        }, 300_000);

        it("markdown: Ctrl+K Ctrl+E formats the heading and the list the prettier way", { timeout: 300_000 }, async () => {
            const { session } = await useHeadlessApp({
                files: { "doc.md": MESSY_MD },
                installVsix: [PRETTIER_ID],
                open: ["doc.md"],
            });
            await session.waitForNode("EditorElement");
            // The prettier status bar item appears at the end of activate() — that is the
            // readiness signal: by then the providers are already registered.
            await session.waitForText((text) => text.includes("Prettier"), {
                timeoutMs: 120_000,
                intervalMs: 500,
            });

            const before = frameToText(await session.captureFrame());
            expect(before).toContain("#   Hello");
            expect(before).toContain("*  item one");

            await session.key("Ctrl+K");
            await session.key("Ctrl+E");

            await session.waitForText((text) => text.includes("- item one") && text.includes("- item two"), {
                timeoutMs: 60_000,
                intervalMs: 500,
            });
            const after = frameToText(await session.captureFrame());
            expect(after).toContain("# Hello");
            expect(after).not.toContain("#   Hello");
        });

        it("json: Ctrl+K Ctrl+E spaces the json the prettier way", { timeout: 300_000 }, async () => {
            const { session } = await useHeadlessApp({
                files: { "data.json": MESSY_JSON },
                installVsix: [PRETTIER_ID],
                open: ["data.json"],
            });
            await session.waitForNode("EditorElement");
            await session.waitForText((text) => text.includes("Prettier"), {
                timeoutMs: 120_000,
                intervalMs: 500,
            });

            expect(frameToText(await session.captureFrame())).toContain('{"a":1,');

            await session.key("Ctrl+K");
            await session.key("Ctrl+E");

            await session.waitForText((text) => text.includes('{ "a": 1, "b": [1, 2, 3] }'), {
                timeoutMs: 60_000,
                intervalMs: 500,
            });
        });
    },
);
