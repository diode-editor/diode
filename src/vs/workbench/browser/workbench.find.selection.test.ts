import { afterEach, describe, expect, it } from "vitest";

import { FindComponentDIToken } from "../contrib/find/browser/findComponent.ts";
import { EditorServiceDIToken } from "../services/editor/browser/editorService.ts";

import type { FindContext } from "./workbench.find.testUtils.ts";
import { createFindApp, disposeFindApp, type } from "./workbench.find.testUtils.ts";

/** Current text of the active group's find widget query input. */
function query(ctx: FindContext): string {
    const groupId = ctx.harness.container.get(EditorServiceDIToken).activeGroup.id;
    return ctx.harness.container.get(FindComponentDIToken).widgetFor(groupId)!.getQuery();
}

describe("Workbench — find query is selected on open", () => {
    let ctx: FindContext;

    afterEach(() => {
        disposeFindApp(ctx);
    });

    it("reopening (Ctrl+F) keeps the old query but selected, so typing replaces it", () => {
        ctx = createFindApp("foo bar foo bar");
        ctx.testApp.sendKey("Ctrl+F");
        type(ctx.testApp, "foo");
        expect(ctx.activeEditor().viewState.searchMatches).toHaveLength(2);

        // Escape hides the widget but keeps the query around.
        ctx.testApp.sendKey("Escape");
        ctx.testApp.sendKey("Ctrl+F");
        expect(query(ctx)).toBe("foo");

        // The whole query is selected → typing replaces it instead of appending.
        type(ctx.testApp, "bar");
        expect(query(ctx)).toBe("bar");
        // …and matches were recomputed for the new query.
        expect(ctx.activeEditor().viewState.searchMatches).toHaveLength(2);
    });

    it("Ctrl+F on an already-open widget selects the query too (VS Code behaviour)", () => {
        ctx = createFindApp("foo bar foo bar");
        ctx.testApp.sendKey("Ctrl+F");
        type(ctx.testApp, "foo");

        // Widget stays open; a second Ctrl+F selects the whole query.
        ctx.testApp.sendKey("Ctrl+F");
        type(ctx.testApp, "bar");

        expect(query(ctx)).toBe("bar");
        expect(ctx.activeEditor().viewState.searchMatches).toHaveLength(2);
    });

    it("Backspace on the reselected query erases it whole", () => {
        ctx = createFindApp("foo bar foo bar");
        ctx.testApp.sendKey("Ctrl+F");
        type(ctx.testApp, "foo");

        ctx.testApp.sendKey("Ctrl+F");
        ctx.testApp.sendKey("Backspace");

        expect(query(ctx)).toBe("");
    });
});
