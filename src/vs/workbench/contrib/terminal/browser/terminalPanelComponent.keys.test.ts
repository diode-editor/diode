import { TerminalViewElement } from "@tuidom/elements/terminal/terminalViewElement";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import type { FakeTerminalSurface } from "../../../../../TestUtils/FakeTerminalSurface.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";

import { TerminalServiceDIToken } from "./terminalService.ts";

const TOGGLE_TERMINAL = "workbench.action.terminal.toggleTerminal";

/** #819: like xterm.js, the terminal sends Ctrl+letter to the shell but leaves Ctrl+Shift+letter to the workbench. */
describe("Terminal encodes Ctrl+letter but not Ctrl+Shift+letter", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let surface: FakeTerminalSurface;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-terminal-keys-", files: { "alpha.txt": "Alpha" } });
        h = createAppTestHarness({ workspaceFolder: ws.dir, openFile: `${ws.dir}/alpha.txt`, focusEditor: true });
        h.commands.execute(TOGGLE_TERMINAL);
        expect(h.testApp.focusedElement).toBeInstanceOf(TerminalViewElement);
        const instance = h.container.get(TerminalServiceDIToken).getActiveInstance();
        /* v8 ignore start -- test helper: Toggle Terminal always opens a terminal */
        if (instance === null) throw new Error("expected an open terminal");
        /* v8 ignore stop */
        surface = instance.session as unknown as FakeTerminalSurface;
        surface.writes.length = 0;
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("Ctrl+Y goes to the shell as ^Y", () => {
        h.testApp.sendKey("Ctrl+Y");

        expect(surface.writes).toEqual(["\x19"]);
    });

    it("Ctrl+Shift+Y does not reach the shell", () => {
        h.testApp.sendKey("Ctrl+Shift+Y");

        expect(surface.writes).toEqual([]);
    });
});
