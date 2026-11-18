import { createRequire } from "node:module";

import { beforeAll, describe, it } from "vitest";

import { MARKETPLACE_OFFLINE } from "../src/TestUtils/marketplaceEnv.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

/**
 * Stock Error Lens from the marketplace, version not pinned (docs/TESTING.md). It decorates only the lines around
 * `TextEditor.visibleRanges` (± 100) and redraws on `onDidChangeTextEditorVisibleRanges`; without the member it threw
 * on `visibleRanges[0]` and drew nothing. The frame is the oracle.
 */

const require_ = createRequire(import.meta.url);

const LINE_COUNT = 400;
const ERRORS = Array.from({ length: LINE_COUNT }, (_, i) => `const v${String(i)}: number = "x${String(i)}";\n`).join(
    "",
);
const MESSAGE = "is not assignable to type 'number'";

// Linux only: the extension host and the language server are spawned (docs/TODO/E2E.md).
describe.skipIf(process.platform !== "linux" || MARKETPLACE_OFFLINE)("SEA binary — stock Error Lens", () => {
    beforeAll(async () => {
        await getBinaryPath();
    }, 300_000);

    it("messages stand at the visible lines, and at new ones after a scroll to the end", { timeout: 240_000 }, async () => {
        const { session } = await useHeadlessApp({
            files: { "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }), "errors.ts": ERRORS },
            settings: {
                "errorLens.maxInlineMessages": 5,
                "diode.lsp.typescript.serverPath": require_.resolve("typescript-language-server/lib/cli.mjs"),
                "diode.lsp.typescript.tsserverPath": require_.resolve("typescript/lib/tsserver.js"),
            },
            installVsix: ["usernamehw.errorlens"],
            open: ["errors.ts"],
        });

        await session.waitForText((t) => t.includes(`"x0";Type 'string' ${MESSAGE}`), {
            timeoutMs: 120_000,
            intervalMs: 500,
        });

        await session.key("Ctrl+End");
        await session.waitForText((t) => t.includes(`"x${String(LINE_COUNT - 1)}";Type 'string' ${MESSAGE}`), {
            timeoutMs: 30_000,
        });
    });
});
