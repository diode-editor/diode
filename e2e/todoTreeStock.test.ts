import type { GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";
import { beforeAll, describe, expect, it } from "vitest";

import { MARKETPLACE_OFFLINE } from "../src/TestUtils/marketplaceEnv.ts";
import type { HeadlessApp } from "./helpers/appSession.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { findTextCell } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";
import { waitUntil } from "./helpers/waitFor.ts";

/**
 * Stock Todo Tree from the marketplace, version not pinned (docs/TESTING.md): what the user sees after a click
 * on a tag line and after `Todo Tree: Expand Tree`. The frame is the oracle.
 */

const FILES = {
    "src/a.ts": "// TODO: first\nconst a = 1;\n// FIXME: broken\n",
    "src/b.ts": "x\ny\n// BUG: b1\n",
    "lib/c.py": "# HACK: c hack\n",
} as const;

const SETTINGS = {
    // The binary writes diode.log into the workspace (cwd); its lines carry tags too.
    "todo-tree.filtering.excludeGlobs": ["**/node_modules", "**/diode.log"],
    "todo-tree.tree.showCountsInTree": true,
};

const KEYS = [{ key: "f7", command: "workbench.view.extension.todo-tree-container" }];

async function openTodos(): Promise<HeadlessApp> {
    const app = await useHeadlessApp({
        files: FILES,
        settings: SETTINGS,
        keybindings: KEYS,
        installVsix: ["Gruntfuggly.todo-tree"],
        open: [".", "src/a.ts"],
        cols: 140,
        rows: 38,
    });
    await app.session.waitForReady();
    await app.session.executeCommand("workbench.view.extension.todo-tree-container");
    await app.session.waitForText((t) => t.includes("workspace 4"), { timeoutMs: 60_000 });
    return app;
}

async function clickText(app: HeadlessApp, needle: string): Promise<void> {
    const frame = await app.session.waitForText((t) => t.includes(needle), { timeoutMs: 30_000 });
    const cell = findTextCell(frame, needle);
    if (cell === null) throw new Error(`"${needle}" is not on screen`);
    await app.session.click(cell.x, cell.y);
}

/** Background of the row that shows `needle`, at its first cell. */
function rowBg(frame: GridSnapshot, needle: string): unknown {
    const cell = findTextCell(frame, needle);
    return cell === null ? undefined : frame.cells[cell.y * frame.cols + cell.x].bg;
}

describe.skipIf(process.platform === "win32" || MARKETPLACE_OFFLINE)("SEA binary — stock Todo Tree", () => {
    beforeAll(async () => {
        await getBinaryPath();
    }, 300_000);

    it(
        "a click on a tag line moves the keyboard to the editor: typing lands on the tag's line",
        { timeout: 180_000 },
        async () => {
            const app = await openTodos();
            await clickText(app, "workspace 4");
            await clickText(app, "src 3");
            await clickText(app, "b.ts 1");
            await clickText(app, "BUG : b1");
            await app.session.waitForText((t) => t.includes("b.ts ×") && t.includes("Ln 3, Col 1"));
            // Then the extension follows the active editor: `reveal(fileNode, { select: true, focus: false })`
            // selects the b.ts row. `focus: false` must leave the keyboard in the editor.
            await waitUntil(
                () => app.session.captureFrame(),
                (frame) => rowBg(frame, "b.ts 1") !== rowBg(frame, "lib 1"),
                { timeoutMs: 10_000, describe: "the b.ts row selected by the reveal" },
            );
            await app.session.waitForIdle();

            // In VS Code the item's `vscode.open` focuses the editor and the reveal keeps it there; here the focus
            // ends on the TODOS pane header and typing goes nowhere.
            expect(await app.session.focusedType()).toBe("EditorElement");
            await app.session.text("QQ");
            await app.session.waitForText((t) => t.includes("QQ// BUG: b1"), { timeoutMs: 10_000 });
        },
    );

    it(
        "Todo Tree: Expand Tree shows the folders, files and tag lines, not blank rows",
        { timeout: 180_000 },
        async () => {
            const app = await openTodos();
            await app.session.executeCommand("todo-tree.expand");
            // Here the workspace node keeps a collapsed twistie with two empty rows under it, and its children
            // are never requested from the extension.
            await app.session.waitForText((t) => t.includes("FIXME : broken") && t.includes("HACK : c hack"), {
                timeoutMs: 20_000,
            });
        },
    );
});
