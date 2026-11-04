import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { createTestConfigurationService } from "../../../TestUtils/testConfigurationService.ts";
import type { EditorElement } from "../../editor/browser/editorElement.ts";

// Russian layout with extended keys (Kitty / tmux `extended-keys`): the key arrives as the Cyrillic
// character, and only its code says which physical key was pressed. Cyrillic "Ha" sits on BracketLeft.
const CTRL_SHIFT_HA_CSI_U = "\x1b[1093;6u";
// tmux `extended-keys-format xterm` (the default on 3.5+, the only format on 3.4): modifyOtherKeys.
const CTRL_SHIFT_HA_XTERM = "\x1b[27;6;1093~";
// A plain Escape in CSI u: proves extended keys, so the `pc csi-u` keymap is active.
const ESCAPE_CSI_U = "\x1b[27u";

// 0: a   ← region 0..1
// 1:   b
const BLOCK = "a\n  b\n";

describe("Workbench — non-Latin layout keys reach punctuation bindings by physical key", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-non-latin-keys-" });
    });

    afterEach(() => {
        ws.dispose();
    });

    async function open(): Promise<{ h: IAppHarness; editor: EditorElement }> {
        // Ctrl+Shift keys are gated on an extended tier, which only an explicit setting turns on (#1049).
        const h = createAppTestHarness({
            openFile: ws.writeFile("block.txt", BLOCK),
            configurationService: createTestConfigurationService({ "terminal.tier": "csi-u" }),
        });
        h.workbench.focusEditor();
        const editor = h.testApp.querySelector("EditorElement") as EditorElement;
        // The workbench computes folding regions after a debounce, not on open.
        await vi.waitFor(() => {
            expect(editor.viewState.foldingRegionContaining(0)?.isCollapsed).toBe(false);
        });
        return { h, editor };
    }

    it.each([
        ["CSI u", CTRL_SHIFT_HA_CSI_U],
        ["xterm modifyOtherKeys", CTRL_SHIFT_HA_XTERM],
    ])("Ctrl+Shift+Cyrillic Ha (%s) folds the block like Ctrl+Shift+[", async (_format, raw) => {
        const { h, editor } = await open();

        h.testApp.backend.sendRaw(ESCAPE_CSI_U);
        h.testApp.backend.sendRaw(raw);

        expect(editor.viewState.foldingRegionContaining(0)?.isCollapsed).toBe(true);
        expect(editor.viewState.document.getText()).toBe(BLOCK);
    });
});
