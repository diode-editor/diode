import { afterEach, describe, expect, it } from "vitest";

import type { FindContext } from "./workbench.find.testUtils.ts";
import { createFindApp, disposeFindApp, type } from "./workbench.find.testUtils.ts";

function screen(ctx: FindContext): string {
    ctx.testApp.render();
    return ctx.testApp.backend.screenToString();
}

describe("Workbench — find counter", () => {
    let ctx: FindContext;

    afterEach(() => {
        disposeFindApp(ctx);
    });

    it("renders the match counter and updates it as you navigate", () => {
        ctx = createFindApp("foo bar foo");
        ctx.testApp.sendKey("Ctrl+F");
        type(ctx.testApp, "foo");

        expect(screen(ctx)).toContain("1 of 2");

        ctx.testApp.sendKey("Enter");
        expect(screen(ctx)).toContain("2 of 2");
    });

    it("shows 'No results' for a query that matches nothing", () => {
        ctx = createFindApp("foo bar foo");
        ctx.testApp.sendKey("Ctrl+F");
        type(ctx.testApp, "zzz");

        expect(ctx.activeEditor().viewState.searchMatches).toEqual([]);
        expect(ctx.activeEditor().viewState.currentSearchMatchIndex).toBe(-1);
        expect(screen(ctx)).toContain("No results");
    });

    it("hides the counter when the query is empty", () => {
        ctx = createFindApp("foo bar foo");
        ctx.testApp.sendKey("Ctrl+F");

        const blank = screen(ctx);
        expect(blank).not.toContain(" of ");
        expect(blank).not.toContain("No results");
        expect(ctx.activeEditor().viewState.searchMatches).toEqual([]);
    });

    it("clears the counter after the query is erased with Backspace", () => {
        ctx = createFindApp("foo bar foo");
        ctx.testApp.sendKey("Ctrl+F");
        type(ctx.testApp, "foo");
        expect(screen(ctx)).toContain("1 of 2");

        for (let i = 0; i < 3; i++) ctx.testApp.sendKey("Backspace");

        const erased = screen(ctx);
        expect(erased).not.toContain(" of ");
        expect(erased).not.toContain("No results");
        expect(ctx.activeEditor().viewState.searchMatches).toEqual([]);
    });
});
