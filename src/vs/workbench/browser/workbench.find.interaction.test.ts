import * as fs from "node:fs";
import * as path from "node:path";

import type { MouseAction, MouseToken } from "@tuidom/core/input/rawTerminalToken";
import { afterEach, describe, expect, it } from "vitest";

import type { FindContext } from "./workbench.find.testUtils.ts";
import { createFindApp, disposeFindApp, type } from "./workbench.find.testUtils.ts";

const PREV_GLYPH = "↑";
const NEXT_GLYPH = "↓";
const CLOSE_GLYPH = "✕";

/** 1-based screen column of a glyph on the widget's button row (or -1). */
function buttonColumn(ctx: FindContext, glyph: string): number {
    ctx.testApp.render();
    const rows = ctx.testApp.backend.screenToString().split("\n");
    const row = rows.findIndex((line) => line.includes(CLOSE_GLYPH));
    if (row === -1) return -1;
    const col = rows[row].indexOf(glyph);
    return col === -1 ? -1 : col + 1; // MouseToken coords are 1-based
}

function clickButton(ctx: FindContext, glyph: string): void {
    const rows = ctx.testApp.backend.screenToString().split("\n");
    const y = rows.findIndex((line) => line.includes(CLOSE_GLYPH)) + 1;
    const x = buttonColumn(ctx, glyph);
    const token = (action: MouseAction): MouseToken => ({
        kind: "mouse",
        button: "left",
        action,
        x,
        y,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        raw: "",
    });
    // A ButtonElement activates on "click" (press + release on the same target).
    ctx.testApp.backend.simulateMouse(token("press"));
    ctx.testApp.backend.simulateMouse(token("release"));
}

describe("Workbench — find lifecycle & interaction", () => {
    let ctx: FindContext;

    afterEach(() => {
        disposeFindApp(ctx);
    });

    it("re-opening with Ctrl+F keeps the query and current match", () => {
        ctx = createFindApp("foo bar foo");
        ctx.testApp.sendKey("Ctrl+F");
        type(ctx.testApp, "foo");
        ctx.testApp.sendKey("Enter");
        expect(ctx.activeEditor().viewState.currentSearchMatchIndex).toBe(1);

        ctx.testApp.sendKey("Ctrl+F");
        expect(ctx.testApp.focusedElement?.constructor.name).toBe("InputElement");
        expect(ctx.activeEditor().viewState.currentSearchMatchIndex).toBe(1);
        expect(ctx.activeEditor().viewState.searchMatches).toHaveLength(2);
    });

    it("seeds the query from a single-line selection on open", () => {
        ctx = createFindApp("foo bar foo");
        ctx.testApp.sendKey("Shift+ArrowRight");
        ctx.testApp.sendKey("Shift+ArrowRight");
        ctx.testApp.sendKey("Shift+ArrowRight");

        ctx.testApp.sendKey("Ctrl+F");

        expect(ctx.activeEditor().viewState.searchMatches).toHaveLength(2);
        // The selection's caret sits just past the first match, so the second one becomes current.
        ctx.testApp.render();
        expect(ctx.testApp.backend.screenToString()).toContain("2 of 2");
    });

    it("closes the widget when the active editor changes", () => {
        ctx = createFindApp("foo bar foo");
        ctx.testApp.sendKey("Ctrl+F");
        type(ctx.testApp, "foo");
        expect(ctx.contextKeys.get("findWidgetVisible")).toBe(true);

        const second = path.join(ctx.tmpDir, "second.txt");
        fs.writeFileSync(second, "nothing here");
        ctx.workbench.openFile(second);

        expect(ctx.contextKeys.get("findWidgetVisible")).toBe(false);
    });

    it("clicking the ↓ / ↑ buttons navigates and ✕ closes", () => {
        ctx = createFindApp("foo bar foo");
        ctx.testApp.sendKey("Ctrl+F");
        type(ctx.testApp, "foo");
        expect(ctx.activeEditor().viewState.currentSearchMatchIndex).toBe(0);

        clickButton(ctx, NEXT_GLYPH);
        expect(ctx.activeEditor().viewState.currentSearchMatchIndex).toBe(1);

        clickButton(ctx, PREV_GLYPH);
        expect(ctx.activeEditor().viewState.currentSearchMatchIndex).toBe(0);

        clickButton(ctx, CLOSE_GLYPH);
        expect(ctx.contextKeys.get("findWidgetVisible")).toBe(false);
    });
});
