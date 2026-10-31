import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { findTextCell, frameToText } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const userData = resolve(here, "fixtures", "user-data-with-editor-lifecycle-probe");

// The extension host subprocess flakes in e2e on Windows (see docs/TESTING.md).
const describeLinuxOnly = process.platform === "linux" ? describe : describe.skip;

async function startProbe() {
    const { session } = await useHeadlessApp({
        seedUserData: userData,
        files: { "left.txt": "LEFT-CONTENT here\n", "right.txt": "RIGHT-CONTENT here\n" },
        open: ["."],
        cols: 160,
        rows: 32,
    });
    await session.waitForReady();
    return session;
}

/** #917: the editor lifecycle as an extension sees it, on the edges the issue names. */
describeLinuxOnly("extension API — editor lifecycle edges", () => {
    beforeAll(async () => {
        await getBinaryPath();
    }, 180_000);

    // Upstream: mainThreadDocumentsAndEditors takes the modified side of the active diff editor.
    it("activeTextEditor is the modified side after vscode.diff", async () => {
        const session = await startProbe();

        await session.executeCommand("editorLifecycleProbe.diff");

        const frame = await session.waitForText((t) => t.includes("active after diff:"), { timeoutMs: 20_000 });
        expect(frameToText(frame)).toContain("active after diff: right.txt");
    }, 120_000);

    // Upstream: window.showTextDocument(uri) goes through workspace.openTextDocument, which rejects on a missing file.
    it("showTextDocument with a missing file rejects and opens no tab", async () => {
        const session = await startProbe();

        await session.executeCommand("editorLifecycleProbe.showMissing");

        const frame = await session.waitForText((t) => t.includes("show missing:"), { timeoutMs: 20_000 });
        const screen = frameToText(frame);
        expect(screen).toContain("show missing: rejected");
        expect(screen).not.toContain("missing.txt");
    }, 120_000);

    // Upstream: mainThreadEditor listens to onDidChangeCursorSelection of every editor, whichever group is active.
    it("a click into the inactive group fires a selection event with kind Mouse", async () => {
        const session = await startProbe();
        await session.executeCommand("editorLifecycleProbe.beside");
        await session.waitForText((t) => t.includes("beside done") && t.includes("LEFT-CONTENT"), { timeoutMs: 20_000 });

        const cell = findTextCell(await session.captureFrame(), "LEFT-CONTENT");
        expect(cell).not.toBeNull();
        await session.click((cell?.x ?? 0) + 3, cell?.y ?? 0);

        await session.waitForText((t) => t.includes("mouse selection in left.txt"), { timeoutMs: 10_000 });
    }, 120_000);
});
