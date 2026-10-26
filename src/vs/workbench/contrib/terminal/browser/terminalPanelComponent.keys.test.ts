import { TerminalViewElement } from "@tuidom/elements/terminal/terminalViewElement";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import type { FakeTerminalSurface } from "../../../../../TestUtils/FakeTerminalSurface.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { NotificationServiceDIToken } from "../../../services/notification/browser/notificationService.ts";

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

/** #856: F-keys now reach the shell, but F6 is the only keyboard path to a toast that asks a question. */
describe("F6 in the terminal focuses an asking toast", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let surface: FakeTerminalSurface;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-terminal-f6-", files: { "alpha.txt": "Alpha" } });
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

    it("F6 moves focus to the toast's buttons instead of writing ESC[17~ to the shell", async () => {
        const answered = h.container.get(NotificationServiceDIToken).show({
            severity: "warn",
            message: "Activate?",
            modal: false,
            items: ["Activate", "Free"],
        });
        h.testApp.render();
        expect(h.testApp.backend.screenToString()).toContain("F6 — reply");

        h.testApp.sendKey("F6");
        h.testApp.render();

        expect(surface.writes).toEqual([]);
        expect(h.testApp.backend.screenToString()).toContain("Enter — choose");
        h.testApp.sendKey("Enter");
        await expect(answered.answered).resolves.toBe(0);
    });
});
