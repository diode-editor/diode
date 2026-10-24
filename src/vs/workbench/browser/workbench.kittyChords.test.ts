import type { HFlexElement } from "@tuidom/elements/layout/hFlexElement";
import type { MenuBarElement } from "@tuidom/elements/menu/menuBarElement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import type { EditorElement } from "../../editor/browser/editorElement.ts";

import { statusTexts } from "./parts/statusbar/statusBarComponent.testUtils.ts";

// Kitty keyboard protocol (report all keys + event types): a modifier pressed on its own
// arrives as its own keydown, which a legacy terminal (and `drive`) never sends.
const CTRL_K_DOWN = "\x1b[107;5u";
const CTRL_K_UP = "\x1b[107;5:3u";
const CTRL_UP = "\x1b[57442;1:3u";
const CTRL_DOWN = "\x1b[57442;5u";
const CTRL_L_DOWN = "\x1b[108;5u";
const ALT_DOWN = "\x1b[57443;3u";
const ALT_F_DOWN = "\x1b[102;3u";
const ALT_U_DOWN = "\x1b[117;3u";

// 0: a   ← region 0..1
// 1:   b
const BLOCK = "a\n  b\n";

describe("Workbench — chords with a standalone modifier keydown (Kitty)", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-kitty-chords-" });
    });

    afterEach(() => {
        ws.dispose();
    });

    async function open(): Promise<{ h: IAppHarness; editor: EditorElement; menuBar: MenuBarElement }> {
        const h = createAppTestHarness({ openFile: ws.writeFile("block.txt", BLOCK) });
        h.workbench.focusEditor();
        const editor = h.testApp.querySelector("EditorElement") as EditorElement;
        const menuBar = h.testApp.querySelector("MenuBarElement") as MenuBarElement;
        // The workbench computes folding regions after a debounce, not on open.
        await vi.waitFor(() => {
            expect(isCollapsed(editor)).toBe(false);
        });
        return { h, editor, menuBar };
    }

    function send(h: IAppHarness, ...raw: string[]): void {
        for (const chunk of raw) h.testApp.backend.sendRaw(chunk);
    }

    function isCollapsed(editor: EditorElement): boolean | undefined {
        return editor.viewState.foldingRegionContaining(0)?.isCollapsed;
    }

    function hints(h: IAppHarness): string[] {
        return statusTexts(h.testApp.querySelector("#statusBar") as HFlexElement);
    }

    it("a lone Alt keydown keeps the chord pending, without a 'not a command' hint", async () => {
        const { h } = await open();

        send(h, CTRL_K_DOWN, CTRL_K_UP, CTRL_UP, ALT_DOWN);

        expect(hints(h).some((t) => t.includes("Waiting for next key"))).toBe(true);
        expect(hints(h).some((t) => t.includes("is not a command"))).toBe(false);
    });

    it("Ctrl+K, then Alt pressed on its own, then Alt+F folds the block instead of opening the File menu", async () => {
        const { h, editor, menuBar } = await open();

        send(h, CTRL_K_DOWN, CTRL_K_UP, CTRL_UP, ALT_DOWN, ALT_F_DOWN);

        expect(isCollapsed(editor)).toBe(true);
        expect(menuBar.isMenuOpen).toBe(false);
        expect(editor.viewState.document.getText()).toBe(BLOCK);
        expect(hints(h).some((t) => t.includes("Waiting") || t.includes("is not a command"))).toBe(false);
    });

    it("Ctrl+K, then Alt pressed on its own, then Alt+U unfolds the block", async () => {
        const { h, editor, menuBar } = await open();
        send(h, CTRL_K_DOWN, CTRL_K_UP, CTRL_UP, ALT_DOWN, ALT_F_DOWN);
        expect(isCollapsed(editor)).toBe(true);

        send(h, CTRL_K_DOWN, CTRL_K_UP, CTRL_UP, ALT_DOWN, ALT_U_DOWN);

        expect(isCollapsed(editor)).toBe(false);
        expect(menuBar.isMenuOpen).toBe(false);
    });

    it("Ctrl+K, Ctrl released and pressed again, then Ctrl+L toggles the fold", async () => {
        const { h, editor } = await open();

        send(h, CTRL_K_DOWN, CTRL_K_UP, CTRL_UP, CTRL_DOWN, CTRL_L_DOWN);

        expect(isCollapsed(editor)).toBe(true);
        expect(editor.viewState.document.getText()).toBe(BLOCK);
    });

    it("outside a chord a lone Alt does nothing and Alt+F still opens the File menu", async () => {
        const { h, editor, menuBar } = await open();

        send(h, ALT_DOWN);
        expect(menuBar.isMenuOpen).toBe(false);
        expect(hints(h)).not.toContainEqual(expect.stringContaining("is not a command"));

        send(h, ALT_F_DOWN);
        expect(menuBar.isMenuOpen).toBe(true);
        expect(isCollapsed(editor)).toBe(false);
    });
});
