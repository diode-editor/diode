import { afterEach, describe, expect, it } from "vitest";

import type { TestApp } from "../../../TestUtils/TestApp.ts";

import type { FindContext } from "./workbench.find.testUtils.ts";
import { createFindApp, disposeFindApp, type } from "./workbench.find.testUtils.ts";

/**
 * Shift+Enter has no legacy escape sequence, so the DSL `sendKey` can't express it.
 * Terminals with the Kitty keyboard protocol report it as CSI-u for codepoint 13
 * with the shift modifier (`CSI 13 ; 2 u`) — feed that raw, then flush the parser.
 */
function sendShiftEnter(testApp: TestApp): void {
    testApp.backend.sendRaw("\x1b[13;2u");
    testApp.backend.flushInput();
}

describe("Workbench — find navigation & recompute", () => {
    let ctx: FindContext;

    afterEach(() => {
        disposeFindApp(ctx);
    });

    it("Shift+Enter steps to the previous match and wraps around", () => {
        ctx = createFindApp("foo bar foo");
        ctx.testApp.sendKey("Ctrl+F");
        type(ctx.testApp, "foo");
        expect(ctx.activeEditor().viewState.currentSearchMatchIndex).toBe(0);

        // From the first match, going back wraps to the last.
        sendShiftEnter(ctx.testApp);
        expect(ctx.activeEditor().viewState.currentSearchMatchIndex).toBe(1);

        sendShiftEnter(ctx.testApp);
        expect(ctx.activeEditor().viewState.currentSearchMatchIndex).toBe(0);
    });

    it("в сплите Enter ходит по совпадениям активной группы, а не первой", () => {
        ctx = createFindApp("foo bar foo");
        ctx.harness.commands.execute("workbench.action.splitEditor");
        ctx.testApp.render();
        ctx.testApp.sendKey("Ctrl+F");
        type(ctx.testApp, "foo");
        const editor = ctx.activeEditor();
        expect(editor.viewState.currentSearchMatchIndex).toBe(0);

        ctx.testApp.sendKey("Enter");

        expect(ctx.activeEditor()).toBe(editor);
        expect(editor.viewState.currentSearchMatchIndex).toBe(1);
    });

    it("Enter steps across matches on different lines", () => {
        ctx = createFindApp("foo\nbar foo\nbaz");
        ctx.testApp.sendKey("Ctrl+F");
        type(ctx.testApp, "foo");

        const editor = ctx.activeEditor();
        expect(editor.viewState.searchMatches).toHaveLength(2);
        expect(editor.viewState.currentSearchMatchIndex).toBe(0);
        expect(editor.viewState.searchMatches[0].start.line).toBe(0);

        ctx.testApp.sendKey("Enter");
        expect(editor.viewState.currentSearchMatchIndex).toBe(1);
        expect(editor.viewState.searchMatches[1].start.line).toBe(1);
    });

    it("Backspace recomputes matches for the shortened query", () => {
        ctx = createFindApp("foo food");
        ctx.testApp.sendKey("Ctrl+F");
        type(ctx.testApp, "food");
        // "food" matches once.
        expect(ctx.activeEditor().viewState.searchMatches).toHaveLength(1);

        ctx.testApp.sendKey("Backspace"); // query → "foo"
        // "foo" now matches twice ("foo" and the "foo" inside "food").
        expect(ctx.activeEditor().viewState.searchMatches).toHaveLength(2);
    });

    it("matches case-insensitively through the full pipeline", () => {
        ctx = createFindApp("Foo foo FOO");
        ctx.testApp.sendKey("Ctrl+F");
        type(ctx.testApp, "foo");

        expect(ctx.activeEditor().viewState.searchMatches).toHaveLength(3);
    });
});
