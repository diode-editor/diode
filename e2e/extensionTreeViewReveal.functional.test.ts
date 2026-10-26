import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";
import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { findTextCell } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";
import { waitUntil } from "./helpers/waitFor.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const userData = resolve(here, "fixtures", "user-data-with-tree-outline");

/** Background of the row that shows `needle`, at its first cell. */
function rowBg(frame: GridSnapshot, needle: string): unknown {
    const cell = findTextCell(frame, needle);
    return cell === null ? undefined : frame.cells[cell.y * frame.cols + cell.x].bg;
}

// The extension host subprocess flakes in e2e on Windows (see docs/TESTING.md).
const describeLinuxOnly = process.platform === "linux" ? describe : describe.skip;

/**
 * #877: `treeView.reveal(item, { select: true, focus: false })` (Todo Tree's `autoReveal` after a tag line opens
 * the file) opens the section and selects the row, and the keyboard stays in the editor, as in VS Code.
 */
describeLinuxOnly("extension tree view — reveal without focus", () => {
    beforeAll(async () => {
        await getBinaryPath();
    }, 180_000);

    it("shows the revealed row and typing still lands in the editor", async () => {
        const { session } = await useHeadlessApp({
            seedUserData: userData,
            files: { "a.ts": "const a = 1;\n" },
            open: [".", "a.ts"],
            cols: 120,
            rows: 32,
        });
        await session.waitForReady();
        await session.waitForText((t) => t.includes("const a = 1;") && t.includes("RUN TARGETS"));
        await session.waitForFocus("EditorElement");

        await session.executeCommand("treeOutline.revealServer");
        // The collapsed section is expanded by the reveal, the way upstream's `openView` does.
        await session.waitForText((t) => t.includes("//app 2 targets") && t.includes("server"), {
            timeoutMs: 30_000,
        });
        await waitUntil(
            () => session.captureFrame(),
            (frame) => rowBg(frame, "server") !== rowBg(frame, "main"),
            { timeoutMs: 10_000, describe: "the server row selected by the reveal" },
        );
        await session.waitForIdle();

        expect(await session.focusedType()).toBe("EditorElement");
        await session.text("QQ");
        await session.waitForText((t) => t.includes("QQconst a = 1;"), { timeoutMs: 10_000 });
    }, 120_000);
});
