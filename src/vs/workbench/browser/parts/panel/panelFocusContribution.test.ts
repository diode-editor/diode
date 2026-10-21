import { TerminalViewElement } from "@tuidom/elements/terminal/terminalViewElement";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import type { FakeTerminalSurface } from "../../../../../TestUtils/FakeTerminalSurface.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { EditorElement } from "../../../../editor/browser/editorElement.ts";
import {
    ContextKeyService,
    ContextKeyServiceDIToken,
} from "../../../../platform/contextkey/common/contextKeyService.ts";
import { TerminalService, TerminalServiceDIToken } from "../../../contrib/terminal/browser/terminalService.ts";

const TOGGLE_TERMINAL = "workbench.action.terminal.toggleTerminal";

/** #175: `TerminalViewElement` stayed `activeElement` after `Ctrl+J`, so typing went into an invisible shell. */
describe("PanelFocusContribution — focus does not stay on panel content that left the screen", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let terminal: TerminalService;
    let contextKeys: ContextKeyService;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-panel-focus-", files: { "alpha.txt": "Alpha" } });
        h = createAppTestHarness({ workspaceFolder: ws.dir, openFile: `${ws.dir}/alpha.txt`, focusEditor: true });
        terminal = h.container.get(TerminalServiceDIToken);
        contextKeys = h.container.get(ContextKeyServiceDIToken);
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    function activeSurface(): FakeTerminalSurface {
        const instance = terminal.getActiveInstance();
        /* v8 ignore start -- test helper: the scenario must open the terminal before accessing the session */
        if (instance === null) throw new Error("expected an open terminal");
        /* v8 ignore stop */
        return instance.session as unknown as FakeTerminalSurface;
    }

    it("after hiding the panel focus returns to the editor instead of staying on the terminal", () => {
        h.commands.execute(TOGGLE_TERMINAL); // show + focus
        expect(h.testApp.focusedElement).toBeInstanceOf(TerminalViewElement);

        h.commands.execute(TOGGLE_TERMINAL); // hide

        expect(h.testApp.focusedElement).toBeInstanceOf(EditorElement);
        expect(contextKeys.get("terminalFocus")).toBe(false);
    });

    it("input with the panel hidden goes to the editor, not to the invisible shell", () => {
        h.commands.execute(TOGGLE_TERMINAL);
        const surface = activeSurface();
        surface.writes.length = 0;

        h.commands.execute(TOGGLE_TERMINAL); // hide
        h.testApp.sendKey("x");

        expect(surface.writes).toEqual([]);
        expect(h.activeEditor().getText()).toContain("x");
    });

    it("without open editors focus is simply removed from the hidden terminal", () => {
        const bare = createAppTestHarness({ workspaceFolder: ws.dir });
        try {
            bare.commands.execute(TOGGLE_TERMINAL);
            expect(bare.testApp.focusedElement).toBeInstanceOf(TerminalViewElement);

            bare.commands.execute(TOGGLE_TERMINAL);

            expect(bare.testApp.focusedElement).toBeNull();
        } finally {
            bare.dispose();
        }
    });

    it("switching from the terminal tab to PROBLEMS also releases focus", () => {
        h.commands.execute(TOGGLE_TERMINAL);
        expect(h.testApp.focusedElement).toBeInstanceOf(TerminalViewElement);

        // The panel is already visible; the command only switches the tab.
        h.commands.execute("workbench.actions.view.problems");

        expect(h.testApp.focusedElement).not.toBeInstanceOf(TerminalViewElement);
    });

    it("hiding the panel leaves editor focus alone", () => {
        h.commands.execute(TOGGLE_TERMINAL); // show the panel with the terminal
        h.workbench.focusEditor();
        const focused = h.testApp.focusedElement;
        expect(focused).toBeInstanceOf(EditorElement);

        h.commands.execute(TOGGLE_TERMINAL); // hide

        expect(h.testApp.focusedElement).toBe(focused);
    });
});
