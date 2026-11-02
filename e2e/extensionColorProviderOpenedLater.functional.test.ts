import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

// Squares from an extension's color provider (`registerColorProvider`) in a file opened during the session,
// not only in the one open at startup. Found with Tailwind CSS IntelliSense (#974): `bg-[#00ff00]` in a
// second HTML file had no square until the first keystroke, and the extension was never asked for colors.

const here = fileURLToPath(new URL(".", import.meta.url));
const userData = resolve(here, "fixtures", "user-data-with-color-provider");

const describeLinuxOnly = process.platform === "linux" ? describe : describe.skip;

describeLinuxOnly("extension color provider — a file opened later", () => {
    beforeAll(async () => {
        await getBinaryPath();
    });

    it("a file opened after startup gets the extension's squares without an edit", { timeout: 90_000 }, async () => {
        const { session } = await useHeadlessApp({
            seedUserData: userData,
            files: { "first.txt": "one red two\n", "second.txt": "three red four\n" },
            open: [".", "first.txt"],
            cols: 120,
            rows: 30,
        });
        await session.waitForText((text) => text.includes("one ■ red two"), { timeoutMs: 30_000 });

        await session.executeCommand("workbench.action.quickOpen", "second.txt");
        await session.waitForText((text) => text.includes("second.txt"));
        await session.sendKey("Enter");
        await session.waitForText((text) => text.includes("three red four") || text.includes("three ■ red four"));

        await session.waitForText((text) => text.includes("three ■ red four"), { timeoutMs: 15_000 });
    });
});
