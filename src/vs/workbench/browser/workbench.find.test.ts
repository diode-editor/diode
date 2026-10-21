import { afterEach, describe, expect, it } from "vitest";

import type { FindContext } from "./workbench.find.testUtils.ts";
import { createFindApp, disposeFindApp, type } from "./workbench.find.testUtils.ts";

describe("Workbench — find in file", () => {
    let ctx: FindContext;

    afterEach(() => {
        disposeFindApp(ctx);
    });

    it("Ctrl+F opens the find widget and focuses its input", () => {
        ctx = createFindApp("foo bar foo");
        expect(ctx.contextKeys.get("findWidgetVisible")).toBe(false);

        ctx.testApp.sendKey("Ctrl+F");
        expect(ctx.testApp.focusedElement?.constructor.name).toBe("InputElement");

        // The next dispatch refreshes context keys while the widget is open.
        type(ctx.testApp, "f");
        expect(ctx.contextKeys.get("findWidgetVisible")).toBe(true);
    });

    it("typing into the find widget does not modify the document", () => {
        ctx = createFindApp("foo bar foo");
        const before = ctx.activeEditor().getText();

        ctx.testApp.sendKey("Ctrl+F");
        type(ctx.testApp, "foo");

        expect(ctx.activeEditor().getText()).toBe(before);
        expect(ctx.activeEditor().viewState.searchMatches).toHaveLength(2);
    });

    it("Enter advances to the next match and wraps around", () => {
        ctx = createFindApp("foo bar foo");
        ctx.testApp.sendKey("Ctrl+F");
        type(ctx.testApp, "foo");
        expect(ctx.activeEditor().viewState.currentSearchMatchIndex).toBe(0);

        ctx.testApp.sendKey("Enter");
        expect(ctx.activeEditor().viewState.currentSearchMatchIndex).toBe(1);
        ctx.testApp.sendKey("Enter");
        expect(ctx.activeEditor().viewState.currentSearchMatchIndex).toBe(0);
    });

    it("F3 / Shift+F3 navigate forward and backward", () => {
        ctx = createFindApp("foo bar foo");
        ctx.testApp.sendKey("Ctrl+F");
        type(ctx.testApp, "foo");

        ctx.testApp.sendKey("F3");
        expect(ctx.activeEditor().viewState.currentSearchMatchIndex).toBe(1);
        ctx.testApp.sendKey("Shift+F3");
        expect(ctx.activeEditor().viewState.currentSearchMatchIndex).toBe(0);
    });

    it("Escape closes the widget, clears highlights and returns focus to the editor", () => {
        ctx = createFindApp("foo bar foo");
        ctx.testApp.sendKey("Ctrl+F");
        type(ctx.testApp, "foo");
        expect(ctx.activeEditor().viewState.searchMatches).toHaveLength(2);

        ctx.testApp.sendKey("Escape");

        expect(ctx.testApp.focusedElement?.constructor.name).toBe("EditorElement");
        expect(ctx.activeEditor().viewState.searchMatches).toEqual([]);
    });
});
