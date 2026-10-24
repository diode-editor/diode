import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { startHeadlessApp, type HeadlessApp } from "./helpers/appSession.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameLine, frameToText } from "./helpers/frame.ts";
import type { HeadlessSession } from "./helpers/headlessSession.ts";
import {
    clickText,
    findWidgetLine,
    focusedType,
    openOutput,
    OUTPUT_KEYBINDINGS,
    pickChannel,
    startOutputApp,
} from "./outputPanel.shared.ts";

// The fixes for six defects in PR #197 (255d596) touch shared machinery: Tab traversal of the tree,
// editor rebuild on reload, find target pinning, the read-only gate; these tests watch the neighbors.

describe("Output panel fix — regressions in neighboring mechanisms", () => {
    let app: HeadlessApp | null = null;

    beforeAll(async () => {
        await getBinaryPath();
    }, 300_000);

    afterEach(async () => {
        await app?.dispose();
        app = null;
    });

    const findRow = async (session: HeadlessSession): Promise<string> =>
        findWidgetLine(await session.captureFrame()).trim();

    it("find after pinning follows the tab: close → switch tab → Ctrl+F searches the new one", async () => {
        app = await startOutputApp();
        const { session } = app;
        await session.waitForText((t) => t.includes("greeting"));

        // Session 1: in sample.ts.
        await session.key("Ctrl+F");
        await session.text("greeting");
        expect(await findRow(session)).toContain("of");
        await session.key("Escape");

        // Open a second file and search for something the first one lacks.
        await session.key("Ctrl+P");
        await session.text("wireTypes.decorations");
        await session.key("Enter");
        await session.waitForText((t) => t.includes("wireTypes"));

        await session.key("Ctrl+F");
        await session.text("decoration");
        // If the target stuck to the first tab, this would be "No results".
        expect(await findRow(session)).not.toContain("No results");
    }, 180_000);

    /**
     * Was a known defect (`it.fails`): closing find on a tab switch sent focus back into the hidden tab.
     * Fixed in TUIDom (restoreFocus keeps focus that left the overlay, #818). The workspace is a hermetic
     * folder, not repoRoot: on a large repository background noise (LSP, git, builds into `dist/`) caused flakes.
     */
    it("find left open survives a tab switch", async () => {
        const workspace = mkdtempSync(join(tmpdir(), "diode-find-focus-"));
        const first = join(workspace, "alpha.ts");
        writeFileSync(first, "export const greeting = 'hello';\n");
        writeFileSync(join(workspace, "beta.ts"), "export const decoration = 42;\n");
        app = await startHeadlessApp({ cols: 120, rows: 32, open: [workspace, first], cwd: workspace });
        const { session } = app;
        await session.waitForText((t) => t.includes("greeting"));
        await session.key("Ctrl+F");
        await session.text("greeting");

        await session.key("Ctrl+P");
        await session.text("beta");
        await session.key("Enter");
        await session.key("Escape");

        // The app is alive; input must reach the visible editor.
        expect((await session.getDocument()).root).not.toBeNull();
        await session.text("REG");
        expect(frameToText(await session.captureFrame())).toContain("REG");
    }, 180_000);

    it("Tab inside an open find widget stays inside the widget", async () => {
        app = await startOutputApp();
        const { session } = app;
        await session.waitForText((t) => t.includes("greeting"));
        await session.key("Ctrl+F");
        expect(await focusedType(session)).toBe("InputElement");
        await session.key("Tab");
        expect(await focusedType(session)).not.toBeUndefined();
        await session.key("Escape");
        expect(await focusedType(session)).toBe("EditorElement");
    }, 180_000);

    it("Tab in a writable editor still inserts indentation", async () => {
        app = await startOutputApp();
        const { session } = app;
        await session.waitForText((t) => t.includes("greeting"));
        // Cursor right after `greeting`: Tab there inserts alignment whitespace.
        await clickText(session, "const greeting", { dx: "const greeting".length });
        await session.key("Tab");
        const row = findTextRow(await session.captureFrame(), "const greeting");
        // Cursor at visible column 14, tabSize 4 (detected from the fixture) → two
        // spaces UP TO tab stop 16, not four: Tab aligns to tab stops.
        expect(frameLine(await session.captureFrame(), row)).toContain("const greeting   = ");
        expect(await focusedType(session)).toBe("EditorElement");
    }, 180_000);

    it("read-only on a regular tab still toggles", async () => {
        app = await startOutputApp();
        const { session } = app;
        await session.waitForText((t) => t.includes("greeting"));
        await clickText(session, "const greeting", { dx: "const ".length });

        await session.key("Alt+R"); // toggleActiveEditorReadonlyInSession
        expect(frameLine(await session.captureFrame(), 1)).toContain("\uea75"); // nf-cod-lock on the tab
        await session.text("NOPE");
        expect(frameToText(await session.captureFrame())).not.toContain("NOPE");

        await session.key("Alt+R"); // clear read-only
        expect(frameLine(await session.captureFrame(), 1)).not.toContain("\uea75");
        await session.text("YES");
        expect(frameToText(await session.captureFrame())).toContain("YES");
    }, 180_000);

    it("live Output tail follows the log when the cursor is at the end", async () => {
        app = await startOutputApp();
        const { session } = app;
        await openOutput(session);
        await pickChannel(session, "Keybindings");

        // Fill the log well beyond the panel height and check that the latest lines are visible.
        for (let i = 0; i < 20; i++) await session.key("ArrowRight");
        const f = await session.captureFrame();
        const lineNos: number[] = [];
        for (let y = 21; y <= 29; y++) {
            const m = /^\s*(\d+)\s+\d\d:\d\d:\d\d/u.exec(frameLine(f, y).slice(32));
            if (m !== null) lineNos.push(Number(m[1]));
        }
        expect(lineNos.length, "log lines should be visible in the panel").toBeGreaterThan(0);
        expect(Math.max(...lineNos)).toBeGreaterThan(15);
    }, 180_000);

    it("reloading a file from disk does not steal focus when the user is not in the editor", async () => {
        const dir = mkdtempSync(join(tmpdir(), "diode-reload-"));
        const file = join(dir, "watched.txt");
        writeFileSync(file, "original line\n");

        app = await startHeadlessApp({
            cols: 120,
            rows: 32,
            keybindings: OUTPUT_KEYBINDINGS,
            open: [dir, file],
            cwd: dir,
        });
        const { session } = app;
        await session.waitForText((t) => t.includes("original line"));

        // Focus the file tree; `maxX` avoids hitting the same-named tab at the top.
        await clickText(session, "watched.txt", { maxX: 20 });
        const before = await focusedType(session);
        expect(before, "focus should leave the editor").not.toBe("EditorElement");

        writeFileSync(file, "changed on disk\n");
        await session.waitForText((t) => t.includes("changed on disk"), { timeoutMs: 15_000 });

        expect(await focusedType(session)).toBe(before);
    }, 180_000);
});

/** -1 if not found. */
function findTextRow(frame: import("@tuidom/core/rendering/gridSnapshot").GridSnapshot, needle: string): number {
    for (let y = 0; y < frame.rows; y++) if (frameLine(frame, y).includes(needle)) return y;
    return -1;
}
