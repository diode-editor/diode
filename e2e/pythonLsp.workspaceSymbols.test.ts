import { beforeAll, describe, expect, it } from "vitest";

import { BASEDPYRIGHT_ID } from "../src/TestUtils/basedpyrightFixture.ts";
import { MARKETPLACE_OFFLINE } from "../src/TestUtils/marketplaceEnv.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";
import { waitUntil } from "./helpers/waitFor.ts";

// `Square` is only in shapes.py and the open file is main.py, so a row with it can only be a search result.
const FILES = {
    "main.py": 'reply: int = "not an int"\n',
    "shapes.py": "class Shape:\n    pass\n\n\nclass Square(Shape):\n    pass\n",
};

const UNDERCURL = 8;

// Linux only: extension host + a forked language server (docs/TODO/E2E.md).
describe.skipIf(process.platform === "win32" || process.platform === "darwin" || MARKETPLACE_OFFLINE)(
    "SEA binary — `#` on the stock basedpyright",
    () => {
        beforeAll(async () => {
            await getBinaryPath();
        }, 300_000);

        it("`#Square` lists a class from an unopened file, Enter goes there", { timeout: 300_000 }, async () => {
            const { session } = await useHeadlessApp({
                files: FILES,
                installVsix: [BASEDPYRIGHT_ID],
                open: [".", "main.py"],
            });
            await session.waitForNode("EditorElement");
            await waitUntil(
                () => session.captureFrame(),
                (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
                { describe: "undercurl squiggle from basedpyright", timeoutMs: 180_000, intervalMs: 500 },
            );

            await session.key("Ctrl+p");
            await session.waitForNode("#quickInput");
            await session.sendText("#Square");

            const isResultRow = (row: string): boolean => row.includes("Square") && !row.includes("#Square");
            await session.waitForText((text) => text.split("\n").some(isResultRow), {
                timeoutMs: 60_000,
                intervalMs: 500,
            });

            await session.key("Enter");
            await session.waitForText((text) => text.includes("Ln 5, Col 7"), { timeoutMs: 30_000, intervalMs: 250 });
            const frame = frameToText(await session.captureFrame());
            expect(frame).toContain("class Square(Shape):");
            expect(frame).toContain("shapes.py");
        });
    },
);
