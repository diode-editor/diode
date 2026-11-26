import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { frameToText } from "./helpers/frame.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

// `TextEditor.visibleRanges` of an editor opened during the session, read in `onDidChangeActiveTextEditor` (Error
// Lens does exactly that, #1226). The probe extension shows `OPEN <file> <first-last>` in the status bar and never
// updates it from later events, so the frame shows the value the extension got at that moment.

const here = fileURLToPath(new URL(".", import.meta.url));
const userData = resolve(here, "fixtures", "user-data-with-visible-ranges-on-open");

const describeLinuxOnly = process.platform === "linux" ? describe : describe.skip;

const THIRTY_LINES = Array.from({ length: 30 }, (_, i) => `line ${String(i + 1)}`).join("\n");

describeLinuxOnly("extension API — visibleRanges of an editor opened later", () => {
    beforeAll(async () => {
        await getBinaryPath();
    });

    it(
        "in onDidChangeActiveTextEditor a 30-line file in a 45-row terminal is visible as a whole",
        { timeout: 90_000 },
        async () => {
            const { session } = await useHeadlessApp({
                seedUserData: userData,
                files: { "first.txt": "first\n", "second.txt": THIRTY_LINES },
                open: [".", "first.txt"],
                cols: 120,
                rows: 45,
            });
            await session.waitForText((text) => text.includes("OPEN -"), { timeoutMs: 30_000 });

            await session.executeCommand("workbench.action.quickOpen", "second.txt");
            await session.waitForText((text) => text.includes("second.txt"));
            await session.sendKey("Enter");
            await session.waitForText((text) => text.includes("OPEN second.txt") && text.includes("line 30"));

            // All 30 lines stand on screen (the editor has ~40 rows), so the extension must see 1-30.
            const frame = frameToText(await session.captureFrame());
            expect(frame).toContain("line 30");
            expect(/OPEN second\.txt [\d,-]+/.exec(frame)?.[0]).toBe("OPEN second.txt 1-30");
        },
    );
});
