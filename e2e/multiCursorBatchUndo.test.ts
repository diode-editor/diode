import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

// An edit batch is applied bottom-up, while events fire in document order: without
// shifting the boundaries the view got line numbers outside the document, and the exception in the main
// loop killed the process. Unit tests see only the exception; only e2e sees the process dying.

describe("Multi-cursor: undo of a multi-line paste", () => {
    beforeAll(async () => {
        await getBinaryPath();
    }, 300_000);

    it("the editor stays alive, text and cursors are restored", async () => {
        const { session } = await useHeadlessApp({
            files: { "empty.txt": "\n\n\n\n" },
            open: ["empty.txt"],
            cols: 80,
            rows: 16,
        });
        await session.waitForText((t) => t.includes("empty.txt"));

        // Two cursors on empty lines at the END of the document: the paste shifts the lines
        // below the lower cursor, and the undo addresses line numbers that no longer exist.
        for (let i = 0; i < 4; i++) await session.key("ArrowDown");
        await session.key("Shift+Alt+ArrowUp");
        await session.waitForText((t) => t.includes("(2 selections)"));

        // A paste (not typing) — a single edit batch for both cursors.
        await session.text("ins\ntext");
        await session.waitForText((t) => /Ln 5, Col 5/u.test(t));
        expect(frameToText(await session.captureFrame())).toContain("ins");

        await session.key("Ctrl+z");

        // The frame was captured — the process is alive; the text is empty, two cursors again.
        const frame = frameToText(await session.waitForText((t) => !t.includes("ins")));
        expect(frame).toContain("(2 selections)");
        expect(frame).toMatch(/Ln 4, Col 1/u);
    });
});
