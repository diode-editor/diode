import { afterEach, describe, expect, it } from "vitest";

import type { SuggestContext } from "./workbench.suggest.testUtils.ts";
import { createSuggestApp, disposeSuggestApp } from "./workbench.suggest.testUtils.ts";

describe("Workbench — suggest widget keyboard integration", () => {
    let ctx: SuggestContext;

    afterEach(() => {
        disposeSuggestApp(ctx);
    });

    /** Word-based, no providers. */
    async function open(): Promise<void> {
        ctx.testApp.sendKey("End"); // cursor to end of line → prefix "i"
        await ctx.completion.trigger();
    }

    it("the popup opens without taking focus from the editor", async () => {
        ctx = createSuggestApp("indent_style indent_size i");
        await open();
        expect(ctx.completion.isOpen()).toBe(true);
        expect(ctx.testApp.focusedElement?.constructor.name).toBe("EditorElement");
        expect(ctx.completion.view.items.map((i) => i.label)).toEqual(["indent_style", "indent_size"]);
    });

    it("ArrowDown with the popup open moves the selection (not the editor cursor)", async () => {
        ctx = createSuggestApp("indent_style indent_size i");
        await open();
        const caretBefore = ctx.activeEditor().viewState.selections[0].active;
        expect(ctx.completion.view.selectedIndex).toBe(0);

        ctx.testApp.sendKey("ArrowDown");

        expect(ctx.contextKeys.get("suggestWidgetVisible")).toBe(true);
        expect(ctx.completion.view.selectedIndex).toBe(1);
        expect(ctx.activeEditor().viewState.selections[0].active).toEqual(caretBefore);
    });

    it("ArrowUp / PageDown / PageUp are routed to suggest commands too", async () => {
        ctx = createSuggestApp("indent_style indent_size i");
        await open();
        ctx.testApp.sendKey("ArrowDown");
        expect(ctx.completion.view.selectedIndex).toBe(1);
        ctx.testApp.sendKey("ArrowUp");
        expect(ctx.completion.view.selectedIndex).toBe(0);
        ctx.testApp.sendKey("PageDown");
        expect(ctx.completion.view.selectedIndex).toBe(1);
        ctx.testApp.sendKey("PageUp");
        expect(ctx.completion.view.selectedIndex).toBe(0);
        expect(ctx.activeEditor().viewState.selections[0].active.line).toBe(0);
    });

    it("Enter accepts the selected item without inserting a line break", async () => {
        ctx = createSuggestApp("indent_style indent_size i");
        await open();
        ctx.testApp.sendKey("ArrowDown"); // select indent_size

        ctx.testApp.sendKey("Enter");

        const text = ctx.activeEditor().getText();
        expect(text).toBe("indent_style indent_size indent_size");
        expect(text).not.toContain("\n"); // the paired Enter keypress did not insert \n
        expect(ctx.completion.isOpen()).toBe(false);
    });

    it("Escape closes the popup, focus stays in the editor", async () => {
        ctx = createSuggestApp("indent_style indent_size i");
        await open();
        expect(ctx.completion.isOpen()).toBe(true);

        ctx.testApp.sendKey("Escape");

        expect(ctx.completion.isOpen()).toBe(false);
        expect(ctx.testApp.focusedElement?.constructor.name).toBe("EditorElement");
    });

    it("Ctrl+Space with the popup open toggles the details pane instead of requesting the list again", async () => {
        ctx = createSuggestApp("indent_style indent_size i");
        await open();
        expect(ctx.completion.isOpen()).toBe(true);
        // Default: the details panel is collapsed (as in VS Code).
        expect(ctx.component.detailsVisible).toBe(false);

        ctx.testApp.sendKey("Ctrl+Space");
        expect(ctx.component.detailsVisible).toBe(true);

        ctx.testApp.sendKey("Ctrl+Space");
        expect(ctx.component.detailsVisible).toBe(false);
        expect(ctx.completion.isOpen()).toBe(true);
    });

    it("ArrowDown with the popup closed moves the editor cursor (cursorDown)", () => {
        ctx = createSuggestApp("aa\nbb");
        expect(ctx.completion.isOpen()).toBe(false);
        expect(ctx.activeEditor().viewState.selections[0].active.line).toBe(0);

        ctx.testApp.sendKey("ArrowDown");

        expect(ctx.contextKeys.get("suggestWidgetVisible")).toBe(false);
        expect(ctx.activeEditor().viewState.selections[0].active.line).toBe(1);
    });
});
